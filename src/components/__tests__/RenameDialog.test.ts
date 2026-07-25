import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import RenameDialog from '../RenameDialog.vue'
import { useKeysStore } from '../../stores/keys'
import { useUiStore } from '../../stores/ui'
import { ykman } from '../../lib/ykman-client'

vi.mock('../../lib/ykman-client', () => ({
  ykman: {
    oathStatus: vi.fn().mockResolvedValue({ passwordProtected: false, remembered: false }),
    oathUnlock: vi.fn().mockResolvedValue(undefined),
    oathListAccounts: vi.fn().mockResolvedValue([]),
    oathRename: vi.fn().mockResolvedValue(undefined),
  },
  describeYkmanError: (e: unknown) => {
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
  vi.mocked(ykman.oathListAccounts).mockResolvedValue([])
  vi.mocked(ykman.oathRename).mockResolvedValue(undefined)
})

describe('RenameDialog', () => {
  it('pre-fills the form from props and emits submit with edited values', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    expect((wrapper.find('[data-test="rename-issuer"]').element as HTMLInputElement).value).toBe('Service')
    expect((wrapper.find('[data-test="rename-name"]').element as HTMLInputElement).value).toBe('user')

    await wrapper.find('[data-test="rename-issuer"]').setValue('Service Full Name')
    await wrapper.find('[data-test="rename-name"]').setValue('user@domain.tld')
    await wrapper.find('[data-test="rename-submit"]').trigger('click')

    expect(wrapper.emitted('submit')).toEqual([['Service Full Name', 'user@domain.tld']])
  })

  it('emits null issuer when the issuer field is cleared', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    await wrapper.find('[data-test="rename-issuer"]').setValue('')
    await wrapper.find('[data-test="rename-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toEqual([[null, 'user']])
  })

  it('does not submit when the name is blank', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    await wrapper.find('[data-test="rename-name"]').setValue('   ')
    await wrapper.find('[data-test="rename-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('emits cancel', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('resets fields to the new props when reopened for a different account', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user' } })
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ issuer: 'Other', name: 'other-user', visible: true })
    expect((wrapper.find('[data-test="rename-issuer"]').element as HTMLInputElement).value).toBe('Other')
    expect((wrapper.find('[data-test="rename-name"]').element as HTMLInputElement).value).toBe('other-user')
  })

  it('shows a spinner and disables Save/Cancel while busy, and does not emit submit', async () => {
    const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user', busy: true } })
    expect(wrapper.find('[data-test="rename-submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button')[0].attributes('disabled')).toBeDefined()
    expect(wrapper.find('.spinner').exists()).toBe(true)

    await wrapper.find('[data-test="rename-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('renders an error message when the error prop is set', () => {
    const wrapper = mount(RenameDialog, {
      props: { visible: true, issuer: 'Service', name: 'user', error: 'Wrong password.' },
    })
    expect(wrapper.text()).toContain('Wrong password.')
  })

  describe('Rename on all keys', () => {
    it('is hidden when only one key is connected', () => {
      useKeysStore().keys = [{ serial: 'AAA', name: 'Key A' }]
      const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user', query: 'Service:user' } })
      expect(wrapper.find('[data-test="rename-submit-all"]').exists()).toBe(false)
    })

    it('is shown when multiple keys are connected', () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user', query: 'Service:user' } })
      expect(wrapper.find('[data-test="rename-submit-all"]').text()).toBe('Rename on all keys')
    })

    it('renames on every key that has the account, skipping keys that do not', async () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      vi.mocked(ykman.oathListAccounts).mockImplementation(async (serial: string) =>
        serial === 'AAA'
          ? [{ query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false }]
          : [],
      )

      const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user', query: 'Service:user' } })
      await wrapper.find('[data-test="rename-name"]').setValue('user2')
      await wrapper.find('[data-test="rename-submit-all"]').trigger('click')
      await flush()

      expect(ykman.oathRename).toHaveBeenCalledTimes(1)
      expect(ykman.oathRename).toHaveBeenCalledWith('AAA', 'Service:user', 'Service', 'user2', null)

      const results = wrapper.find('[data-test="rename-all-results"]')
      expect(results.text()).toContain('Key A')
      expect(results.text()).toContain('Renamed')
      expect(results.text()).toContain('Key B')
      expect(results.text()).toContain('Not present')
    })

    it('prompts inline for a locked key, then continues and closes on Done', async () => {
      useKeysStore().keys = [
        { serial: 'AAA', name: 'Key A' },
        { serial: 'BBB', name: 'Key B' },
      ]
      vi.mocked(ykman.oathStatus).mockImplementation(async (serial: string) =>
        serial === 'BBB' ? { passwordProtected: true, remembered: false } : { passwordProtected: false, remembered: false },
      )
      vi.mocked(ykman.oathListAccounts).mockResolvedValue([
        { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false },
      ])

      const wrapper = mount(RenameDialog, { props: { visible: true, issuer: 'Service', name: 'user', query: 'Service:user' } })
      await wrapper.find('[data-test="rename-submit-all"]').trigger('click')
      await flush()

      expect(wrapper.find('[data-test="pending-password"]').exists()).toBe(true)
      await wrapper.find('[data-test="pending-password"]').setValue('hunter2')
      await wrapper.find('[data-test="pending-submit"]').trigger('click')
      await flush()

      expect(ykman.oathUnlock).toHaveBeenCalledWith('BBB', 'hunter2', false)
      expect(ykman.oathRename).toHaveBeenCalledWith('BBB', 'Service:user', 'Service', 'user', 'hunter2')
      expect(useUiStore().sessionPasswordFor('BBB')).toBe('hunter2')

      await wrapper.find('[data-test="rename-all-done"]').trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })

  describe('Rename on selected keys', () => {
    it('hides Save and Rename-on-all-keys, showing only the scoped button', () => {
      const wrapper = mount(RenameDialog, {
        props: {
          visible: true,
          issuer: 'Service',
          name: 'user',
          query: 'Service:user',
          selectedKeys: [{ serial: 'BBB', name: 'Key B' }],
        },
      })
      expect(wrapper.find('[data-test="rename-submit"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="rename-submit-all"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="rename-submit-selected"]').text()).toBe('Rename on selected keys')
    })

    it('renames every selected key from its cached session password, without listing or prompting', async () => {
      useUiStore().setSessionPassword('BBB', 'cached-pw')
      const wrapper = mount(RenameDialog, {
        props: {
          visible: true,
          issuer: 'Service',
          name: 'user',
          query: 'Service:user',
          selectedKeys: [
            { serial: 'AAA', name: 'Key A' },
            { serial: 'BBB', name: 'Key B' },
          ],
        },
      })
      await wrapper.find('[data-test="rename-name"]').setValue('user2')
      await wrapper.find('[data-test="rename-submit-selected"]').trigger('click')
      await flush()

      expect(ykman.oathListAccounts).not.toHaveBeenCalled()
      expect(ykman.oathRename).toHaveBeenCalledWith('AAA', 'Service:user', 'Service', 'user2', null)
      expect(ykman.oathRename).toHaveBeenCalledWith('BBB', 'Service:user', 'Service', 'user2', 'cached-pw')

      const results = wrapper.find('[data-test="rename-all-results"]')
      expect(results.text()).toContain('Key A')
      expect(results.text()).toContain('Key B')
      expect(results.text()).toContain('Renamed')

      await wrapper.find('[data-test="rename-all-done"]').trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('reports a per-key error and continues past it', async () => {
      vi.mocked(ykman.oathRename).mockImplementation(async (serial: string) => {
        if (serial === 'BBB') throw { kind: 'WrongPassword' }
      })
      const wrapper = mount(RenameDialog, {
        props: {
          visible: true,
          issuer: 'Service',
          name: 'user',
          query: 'Service:user',
          selectedKeys: [
            { serial: 'AAA', name: 'Key A' },
            { serial: 'BBB', name: 'Key B' },
          ],
        },
      })
      await wrapper.find('[data-test="rename-submit-selected"]').trigger('click')
      await flush()

      const results = wrapper.find('[data-test="rename-all-results"]')
      expect(results.text()).toContain('Key A')
      expect(results.text()).toContain('Renamed')
      expect(results.text()).toContain('Key B')
      expect(results.text()).toContain('Wrong password.')
    })
  })
})
