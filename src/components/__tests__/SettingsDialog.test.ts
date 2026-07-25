import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SettingsDialog from '../SettingsDialog.vue'
import { useKeysStore } from '../../stores/keys'
import { ykman } from '../../lib/ykman-client'
import { PresenceCancelledError } from '../../lib/presence'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('../../lib/ykman-client', () => ({
  ykman: {
    getSettings: vi.fn().mockResolvedValue({
      idleLockMinutes: null,
      launchAtStartup: false,
      lastActiveSerial: null,
      ykmanPath: null,
      rememberWindow: false,
      minimizeToTray: false,
      minimizeOnAutostart: false,
      showWindowOnKeyPlugin: false,
      requireHelloForWrites: false,
      keyNames: {},
    }),
    setLaunchAtStartup: vi.fn().mockResolvedValue(undefined),
    setRememberWindow: vi.fn().mockResolvedValue(undefined),
    setMinimizeToTray: vi.fn().mockResolvedValue(undefined),
    setMinimizeOnAutostart: vi.fn().mockResolvedValue(undefined),
    setShowWindowOnKeyPlugin: vi.fn().mockResolvedValue(undefined),
    setRequireHelloForWrites: vi.fn().mockResolvedValue(undefined),
    checkHelloAvailability: vi.fn().mockResolvedValue(true),
    setYkmanPath: vi.fn().mockResolvedValue(undefined),
    clearYkmanPath: vi.fn().mockResolvedValue(undefined),
  },
  describeYkmanError: (e: unknown) => {
    const err = e as { kind?: string; message?: string }
    if (err?.kind === 'Other' && err.message) return err.message
    return 'Something went wrong talking to the YubiKey.'
  },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.mocked(ykman.getSettings).mockResolvedValue({
    idleLockMinutes: null,
    launchAtStartup: false,
    lastActiveSerial: null,
    ykmanPath: null,
    rememberWindow: false,
    minimizeToTray: false,
    minimizeOnAutostart: false,
    showWindowOnKeyPlugin: false,
    requireHelloForWrites: false,
    keyNames: {},
  })
  vi.mocked(ykman.checkHelloAvailability).mockResolvedValue(true)
})

describe('SettingsDialog', () => {
  it('does not render the idle auto-lock field', () => {
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    expect(wrapper.text()).not.toContain('Idle auto-lock')
  })

  it('prefills the ykman path from settings', async () => {
    vi.mocked(ykman.getSettings).mockResolvedValue({
      idleLockMinutes: null,
      launchAtStartup: false,
      lastActiveSerial: null,
      ykmanPath: 'C:\\custom\\ykman.exe',
      rememberWindow: false,
      minimizeToTray: false,
      minimizeOnAutostart: false,
      showWindowOnKeyPlugin: false,
      requireHelloForWrites: false,
      keyNames: {},
    })
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await flushPromises()
    expect((wrapper.find('[data-test="ykman-path"]').element as HTMLInputElement).value).toBe(
      'C:\\custom\\ykman.exe',
    )
  })

  it('saves a typed path and shows a confirmation', async () => {
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await flushPromises()
    await wrapper.find('[data-test="ykman-path"]').setValue('C:\\custom\\ykman.exe')
    await wrapper.find('[data-test="save-path"]').trigger('click')
    await flushPromises()

    expect(ykman.setYkmanPath).toHaveBeenCalledWith('C:\\custom\\ykman.exe')
    expect(wrapper.find('[data-test="path-message"]').text()).toBe('Saved.')
  })

  it('shows an inline error when saving an invalid path fails', async () => {
    vi.mocked(ykman.setYkmanPath).mockRejectedValueOnce({ kind: 'Other', message: "That file doesn't exist." })
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await flushPromises()
    await wrapper.find('[data-test="ykman-path"]').setValue('C:\\nope\\ykman.exe')
    await wrapper.find('[data-test="save-path"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="path-error"]').text()).toBe("That file doesn't exist.")
  })

  it('clears the custom path and re-polls on Auto-detect', async () => {
    const keys = useKeysStore()
    keys.ykmanMissing = true
    const checkOnceSpy = vi.spyOn(keys, 'checkOnce').mockImplementation(async () => {
      keys.ykmanMissing = false
      return true
    })
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await flushPromises()
    await wrapper.find('[data-test="ykman-path"]').setValue('C:\\custom\\ykman.exe')
    await wrapper.find('[data-test="auto-detect"]').trigger('click')
    await flushPromises()

    expect(ykman.clearYkmanPath).toHaveBeenCalled()
    expect(checkOnceSpy).toHaveBeenCalled()
    expect((wrapper.find('[data-test="ykman-path"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('[data-test="path-message"]').text()).toBe('Found.')
  })

  it('toggles requireHelloForWrites and persists it', async () => {
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await flushPromises()
    await wrapper.find('[data-test="require-hello"]').trigger('click')
    await flushPromises()

    expect(ykman.setRequireHelloForWrites).toHaveBeenCalledWith(true)
  })

  it('reverts the toggle when the Hello confirmation is cancelled', async () => {
    vi.mocked(ykman.setRequireHelloForWrites).mockRejectedValueOnce(new PresenceCancelledError())
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await flushPromises()
    await wrapper.find('[data-test="require-hello"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="require-hello"]').attributes('aria-checked')).toBe('false')
  })

  it('disables the toggle and shows a note when Windows Hello is unavailable', async () => {
    vi.mocked(ykman.checkHelloAvailability).mockResolvedValue(false)
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await flushPromises()

    expect(wrapper.find('[data-test="require-hello"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="hello-unavailable"]').exists()).toBe(true)

    await wrapper.find('[data-test="require-hello"]').trigger('click')
    expect(ykman.setRequireHelloForWrites).not.toHaveBeenCalled()
  })

  it('does not show the unavailable note when Windows Hello is available', async () => {
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await flushPromises()

    expect(wrapper.find('[data-test="require-hello"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="hello-unavailable"]').exists()).toBe(false)
  })

  it('emits close when the back button is clicked', async () => {
    const wrapper = mount(SettingsDialog, { props: { visible: true } })
    await wrapper.find('[data-test="back"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
