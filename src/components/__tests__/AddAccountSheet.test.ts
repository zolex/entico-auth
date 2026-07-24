import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import AddAccountSheet from '../AddAccountSheet.vue'
import { useAccountsStore } from '../../stores/accounts'
import { useKeysStore } from '../../stores/keys'
import { useUiStore } from '../../stores/ui'
import { ykman } from '../../lib/ykman-client'
import { PresenceCancelledError } from '../../lib/presence'
import * as qrDecode from '../../lib/qr-decode'

vi.mock('../../lib/ykman-client', () => ({
  ykman: {
    oathStatus: vi.fn().mockResolvedValue({ passwordProtected: false, remembered: false }),
    oathUnlock: vi.fn().mockResolvedValue(undefined),
    oathAddManual: vi.fn().mockResolvedValue(undefined),
    oathListAccounts: vi.fn().mockResolvedValue([]),
    oathGetCodes: vi.fn().mockResolvedValue([]),
  },
  describeYkmanError: (e: unknown) => {
    if (e instanceof PresenceCancelledError) return 'Cancelled.'
    const err = e as { kind?: string; message?: string }
    if (err?.kind === 'WrongPassword') return 'Wrong password.'
    if (err?.kind === 'Other' && err.message) return err.message
    return 'Something went wrong talking to the YubiKey.'
  },
}))

async function flush() {
  await new Promise((r) => setTimeout(r))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(ykman.oathStatus).mockResolvedValue({ passwordProtected: false, remembered: false })
  vi.mocked(ykman.oathUnlock).mockResolvedValue(undefined)
  vi.mocked(ykman.oathAddManual).mockResolvedValue(undefined)
  vi.mocked(ykman.oathListAccounts).mockResolvedValue([])
  vi.mocked(ykman.oathGetCodes).mockResolvedValue([])
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 1, height: 1 }),
  )
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({}),
  }) as unknown as HTMLCanvasElement['getContext']
})

async function fillManualForm(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('[data-test="issuer"]').setValue('Service')
  await wrapper.find('[data-test="name"]').setValue('user@domain.tld')
  await wrapper.find('[data-test="secret"]').setValue('JBSWY3DPEHPK3PXP')
}

describe('AddAccountSheet', () => {
  it('submits the manual form with parsed advanced defaults', async () => {
    const store = useAccountsStore()
    store.addManual = vi.fn().mockResolvedValue(undefined)

    const wrapper = mount(AddAccountSheet)
    await fillManualForm(wrapper)
    await wrapper.find('[data-test="manual-submit"]').trigger('click')

    expect(store.addManual).toHaveBeenCalledWith({
      issuer: 'Service',
      name: 'user@domain.tld',
      secret: 'JBSWY3DPEHPK3PXP',
      digits: 6,
      algorithm: 'SHA1',
      period: 30,
      touchRequired: false,
    })
  })

  it('stays open with no error text when the presence check is cancelled', async () => {
    const store = useAccountsStore()
    store.addManual = vi.fn().mockRejectedValue(new PresenceCancelledError())

    const wrapper = mount(AddAccountSheet)
    await fillManualForm(wrapper)
    await wrapper.find('[data-test="manual-submit"]').trigger('click')
    await flush()

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('.field-error').exists()).toBe(false)
  })

  it('shows a spinner on the Save button while the manual submit is in flight', async () => {
    const store = useAccountsStore()
    let resolveAdd!: () => void
    store.addManual = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAdd = resolve
        }),
    )

    const wrapper = mount(AddAccountSheet)
    await fillManualForm(wrapper)
    await wrapper.find('[data-test="manual-submit"]').trigger('click')

    expect(wrapper.find('[data-test="manual-submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.spinner').exists()).toBe(true)

    resolveAdd()
    await flush()
  })

  it('auto-opens the file picker and prefills manual fields from a decoded QR in qr mode', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(qrDecode, 'decodeQrFromImageData').mockReturnValue(
      'otpauth://totp/Service:user?secret=ABC123&algorithm=SHA256&digits=8&period=60',
    )

    const wrapper = mount(AddAccountSheet, { props: { mode: 'qr' } })
    await flush()

    expect(clickSpy).toHaveBeenCalled()

    const file = new File(['x'], 'qr.png', { type: 'image/png' })
    const input = wrapper.get<HTMLInputElement>('[data-test="qr-file-input"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.find<HTMLInputElement>('[data-test="issuer"]').element.value).toBe('Service')
    expect(wrapper.find<HTMLInputElement>('[data-test="name"]').element.value).toBe('user')
    expect(wrapper.find<HTMLInputElement>('[data-test="secret"]').element.value).toBe('ABC123')
  })

  it('closes on a cancelled file picker with nothing entered yet', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

    const wrapper = mount(AddAccountSheet, { props: { mode: 'qr' } })
    await flush()

    await wrapper.get('[data-test="qr-file-input"]').trigger('cancel')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('parses a pasted URI and switches to the prefilled manual form, same as the QR flow', async () => {
    const wrapper = mount(AddAccountSheet, { props: { mode: 'uri' } })
    await wrapper.find('[data-test="uri-input"]').setValue(
      'otpauth://totp/Service:user?secret=ABC123&algorithm=SHA256&digits=8&period=60',
    )
    await wrapper.find('[data-test="uri-submit"]').trigger('click')

    expect(wrapper.find<HTMLInputElement>('[data-test="issuer"]').element.value).toBe('Service')
    expect(wrapper.find<HTMLInputElement>('[data-test="name"]').element.value).toBe('user')
    expect(wrapper.find<HTMLInputElement>('[data-test="secret"]').element.value).toBe('ABC123')
    expect(wrapper.find('[data-test="manual-submit"]').exists()).toBe(true)
  })

  it('shows an inline error and stays on the uri tab for a URI that cannot be parsed', async () => {
    const wrapper = mount(AddAccountSheet, { props: { mode: 'uri' } })
    await wrapper.find('[data-test="uri-input"]').setValue('not a uri')
    await wrapper.find('[data-test="uri-submit"]').trigger('click')

    expect(wrapper.text()).toContain('Could not read that URI as an OTP account.')
    expect(wrapper.find('[data-test="uri-input"]').exists()).toBe(true)
  })

  describe('Save to all Keys', () => {
    beforeEach(() => {
      useKeysStore().activeSerial = 'AAA'
    })

    it('is hidden when only one key is connected', async () => {
      useKeysStore().keys = [{ serial: 'AAA', name: 'Key A' }]
      const wrapper = mount(AddAccountSheet)
      expect(wrapper.find('[data-test="manual-submit-all"]').exists()).toBe(false)
    })

    it('is shown when multiple keys are connected', async () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      const wrapper = mount(AddAccountSheet)
      expect(wrapper.find('[data-test="manual-submit-all"]').text()).toBe('Save to all Keys')
    })

    it('saves to every connected key, prompting only for the one needing a password', async () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      vi.mocked(ykman.oathStatus).mockImplementation(async (serial: string) =>
        serial === 'BBB' ? { passwordProtected: true, remembered: false } : { passwordProtected: false, remembered: false },
      )

      const wrapper = mount(AddAccountSheet)
      await fillManualForm(wrapper)
      await wrapper.find('[data-test="manual-submit-all"]').trigger('click')
      await flush()

      expect(ykman.oathAddManual).toHaveBeenCalledWith(
        'AAA',
        { issuer: 'Service', name: 'user@domain.tld', secret: 'JBSWY3DPEHPK3PXP', digits: 6, algorithm: 'SHA1', period: 30, touchRequired: false },
        null,
      )
      expect(wrapper.text()).toContain('Key B')
      expect(wrapper.find('[data-test="pending-password"]').exists()).toBe(true)

      await wrapper.find('[data-test="pending-password"]').setValue('hunter2')
      await wrapper.find('[data-test="pending-submit"]').trigger('click')
      await flush()

      expect(ykman.oathUnlock).toHaveBeenCalledWith('BBB', 'hunter2', false)
      expect(ykman.oathAddManual).toHaveBeenCalledWith(
        'BBB',
        { issuer: 'Service', name: 'user@domain.tld', secret: 'JBSWY3DPEHPK3PXP', digits: 6, algorithm: 'SHA1', period: 30, touchRequired: false },
        'hunter2',
      )
      expect(useUiStore().sessionPasswordFor('BBB')).toBe('hunter2')

      const results = wrapper.find('[data-test="save-all-results"]')
      expect(results.text()).toContain('Key A')
      expect(results.text()).toContain('Key B')

      await wrapper.find('[data-test="save-all-done"]').trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('reuses an already-cached session password without prompting', async () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      useUiStore().setSessionPassword('BBB', 'cached-pw')
      vi.mocked(ykman.oathStatus).mockImplementation(async (serial: string) =>
        serial === 'BBB' ? { passwordProtected: true, remembered: false } : { passwordProtected: false, remembered: false },
      )

      const wrapper = mount(AddAccountSheet)
      await fillManualForm(wrapper)
      await wrapper.find('[data-test="manual-submit-all"]').trigger('click')
      await flush()

      expect(ykman.oathUnlock).not.toHaveBeenCalled()
      expect(ykman.oathAddManual).toHaveBeenCalledWith(expect.any(String), expect.anything(), 'cached-pw')
      expect(wrapper.find('[data-test="save-all-results"]').exists()).toBe(true)
    })

    it('skips a key when its password prompt is skipped, but keeps going for the rest', async () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      vi.mocked(ykman.oathStatus).mockImplementation(async (serial: string) =>
        serial === 'AAA' ? { passwordProtected: true, remembered: false } : { passwordProtected: false, remembered: false },
      )

      const wrapper = mount(AddAccountSheet)
      await fillManualForm(wrapper)
      await wrapper.find('[data-test="manual-submit-all"]').trigger('click')
      await flush()

      expect(wrapper.find('[data-test="pending-password"]').exists()).toBe(true)
      await wrapper.find('[data-test="pending-skip"]').trigger('click')
      await flush()

      expect(ykman.oathAddManual).toHaveBeenCalledTimes(1)
      expect(ykman.oathAddManual).toHaveBeenCalledWith('BBB', expect.anything(), null)

      const results = wrapper.find('[data-test="save-all-results"]')
      expect(results.text()).toContain('Skipped.')
    })

    it('shows Cancelled. for a key where the presence check is declined, and continues past it', async () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      vi.mocked(ykman.oathAddManual).mockImplementation(async (serial: string) => {
        if (serial === 'BBB') throw new PresenceCancelledError()
      })

      const wrapper = mount(AddAccountSheet)
      await fillManualForm(wrapper)
      await wrapper.find('[data-test="manual-submit-all"]').trigger('click')
      await flush()

      const results = wrapper.find('[data-test="save-all-results"]')
      expect(results.text()).toContain('Key A')
      expect(results.text()).toContain('Saved')
      expect(results.text()).toContain('Key B')
      expect(results.text()).toContain('Cancelled.')
    })

    it('continues past a key whose save fails, and reports the reason', async () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      vi.mocked(ykman.oathAddManual).mockImplementation(async (serial: string) => {
        if (serial === 'BBB') throw { kind: 'WrongPassword' }
      })

      const wrapper = mount(AddAccountSheet)
      await fillManualForm(wrapper)
      await wrapper.find('[data-test="manual-submit-all"]').trigger('click')
      await flush()

      const results = wrapper.find('[data-test="save-all-results"]')
      expect(results.text()).toContain('Key A')
      expect(results.text()).toContain('Saved')
      expect(results.text()).toContain('Wrong password.')
    })
  })
})
