import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import App from './App.vue'
import { useAccountsStore } from './stores/accounts'
import { useKeysStore } from './stores/keys'
import { useUiStore } from './stores/ui'
import { PresenceCancelledError } from './lib/presence'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onFocusChanged: vi.fn(),
    isFocused: vi.fn().mockResolvedValue(true),
    isVisible: vi.fn().mockResolvedValue(true),
  })),
}))

vi.mock('./lib/ykman-client', () => ({
  ykman: {
    getSettings: vi.fn().mockResolvedValue({ idleLockMinutes: null }),
    oathStatus: vi.fn().mockResolvedValue({ passwordProtected: false, remembered: false }),
    isDemoMode: vi.fn().mockResolvedValue(false),
  },
  describeYkmanError: (e: unknown) => {
    const err = e as { kind?: string; message?: string }
    if (err?.kind === 'WrongPassword') return 'Wrong password.'
    if (err?.kind === 'Other' && err.message) return err.message
    return 'Something went wrong talking to the YubiKey.'
  },
}))

function mountUnlockedApp() {
  const keys = useKeysStore()
  keys.keys = [{ serial: 'AAA', name: 'Key A' }]
  keys.activeSerial = 'AAA'
  useUiStore().unlock()
  useAccountsStore().accounts = [
    { query: 'q1', issuer: 'Service', name: 'user', period: 30, touchRequired: false, code: '123456', codeExpiresAt: null },
  ]
  // Stop the polling loops from doing anything real during the test - this
  // test only cares about the rename/delete presence-cancellation UX.
  keys.checkOnce = vi.fn().mockResolvedValue(true)
  keys.checkOnceWithRetry = vi.fn().mockResolvedValue(undefined)
  const accounts = useAccountsStore()
  accounts.startAutoRefresh = vi.fn().mockResolvedValue(undefined)
  accounts.stopAutoRefresh = vi.fn()
  return mount(App)
}

async function openContextMenu(wrapper: ReturnType<typeof mountUnlockedApp>) {
  await wrapper.find('.yb-card').trigger('contextmenu')
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('App presence-cancellation UX', () => {
  it('onRenameSubmit stays open with no error text when the presence check is cancelled', async () => {
    const accounts = useAccountsStore()
    const wrapper = mountUnlockedApp()
    accounts.rename = vi.fn().mockRejectedValue(new PresenceCancelledError())

    await openContextMenu(wrapper)
    await wrapper.findAll('.context-menu button')[0].trigger('click')
    expect(wrapper.find('[data-test="rename-submit"]').exists()).toBe(true)

    await wrapper.find('[data-test="rename-submit"]').trigger('click')
    await flushAll()

    expect(accounts.rename).toHaveBeenCalled()
    expect(wrapper.find('[data-test="rename-name"]').exists()).toBe(true)
    expect(wrapper.find('.field-error').exists()).toBe(false)
  })

  it('onDeleteConfirm stays open with no error text when the presence check is cancelled', async () => {
    const accounts = useAccountsStore()
    const wrapper = mountUnlockedApp()
    accounts.remove = vi.fn().mockRejectedValue(new PresenceCancelledError())

    await openContextMenu(wrapper)
    await wrapper.findAll('.context-menu button')[1].trigger('click')
    expect(wrapper.find('[data-test="confirm-danger"]').exists()).toBe(true)

    await wrapper.find('[data-test="confirm-danger"]').trigger('click')
    await flushAll()

    expect(accounts.remove).toHaveBeenCalled()
    expect(wrapper.find('[data-test="confirm-danger"]').exists()).toBe(true)
    expect(wrapper.find('.error').exists()).toBe(false)
  })
})

async function flushAll() {
  await new Promise((r) => setTimeout(r))
}
