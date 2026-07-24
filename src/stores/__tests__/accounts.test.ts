import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAccountsStore } from '../accounts'
import { useKeysStore } from '../keys'
import { useUiStore } from '../ui'
import { ykman } from '../../lib/ykman-client'
import type { OathAccount } from '../../lib/types'

vi.mock('../../lib/ykman-client', () => ({
  ykman: {
    listKeys: vi.fn(),
    checkYkman: vi.fn(),
    oathListAccounts: vi.fn(),
    oathGetCodes: vi.fn(),
    oathGetTouchCode: vi.fn(),
    oathAddManual: vi.fn(),
    oathAddUri: vi.fn(),
    oathRename: vi.fn(),
    oathDelete: vi.fn(),
  },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useAccountsStore', () => {
  it('merges account metadata with live codes by query', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false },
    ])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: null }])

    const store = useAccountsStore()
    await store.refresh()

    expect(store.accounts).toEqual([
      {
        query: 'Service:user',
        issuer: 'Service',
        name: 'user',
        period: 30,
        touchRequired: true, // derived: code entry was null => touch required
        code: null,
        codeExpiresAt: null,
      },
    ])
  })

  it('passes the session password explicitly instead of relying on ykman remembering it', async () => {
    useKeysStore().activeSerial = '36705123'
    useUiStore().setSessionPassword('36705123', 'hunter2')
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([])

    await useAccountsStore().refresh()

    expect(ykman.oathListAccounts).toHaveBeenCalledWith('36705123', 'hunter2')
    expect(ykman.oathGetCodes).toHaveBeenCalledWith('36705123', 'hunter2')
  })

  it('does nothing when no key is active', async () => {
    useKeysStore().activeSerial = null
    const store = useAccountsStore()
    await store.refresh()
    expect(store.accounts).toEqual([])
    expect(ykman.oathListAccounts).not.toHaveBeenCalled()
  })

  it('revealTouchCode fetches and sets the code for one account in place', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z')) // full 30s remaining, well above the wait threshold
    const store = useAccountsStore()
    store.accounts = [
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: true, code: null, codeExpiresAt: null },
    ]
    store.loadedSerial = '36705123'
    vi.mocked(ykman.oathGetTouchCode).mockResolvedValue('654321')

    await store.revealTouchCode('Service:user')

    expect(store.accounts[0].code).toBe('654321')
    expect(store.revealWaiting).toBe(false)
  })

  it('waits out the rest of the period before fetching when the code would be visible under 5s', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.setSystemTime(new Date('2026-07-22T10:00:28.000Z')) // 2s left of a 30s period starting :00
    const store = useAccountsStore()
    store.accounts = [
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: true, code: null, codeExpiresAt: null },
    ]
    store.loadedSerial = '36705123'
    vi.mocked(ykman.oathGetTouchCode).mockResolvedValue('654321')

    const revealPromise = store.revealTouchCode('Service:user')
    // The async function runs synchronously up to its first await, so the
    // wait flag is already flipped before we get a chance to advance timers.
    expect(store.revealWaiting).toBe(true)
    expect(ykman.oathGetTouchCode).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)
    await revealPromise

    expect(store.revealWaiting).toBe(false)
    expect(ykman.oathGetTouchCode).toHaveBeenCalled()
    expect(store.accounts[0].code).toBe('654321')
  })

  it('keeps a touch-revealed code through a background refresh that lands moments later', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.setSystemTime(new Date('2026-07-22T10:00:30.000Z')) // right at a fresh 30s boundary
    const store = useAccountsStore()
    store.accounts = [
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: true, code: null, codeExpiresAt: null },
    ]
    store.loadedSerial = '36705123'
    vi.mocked(ykman.oathGetTouchCode).mockResolvedValue('654321')
    await store.revealTouchCode('Service:user')
    expect(store.accounts[0].code).toBe('654321')

    // A moment later, the app's regular auto-refresh cycle lands - since
    // oathGetCodes never returns touch-required codes, without the
    // codeExpiresAt guard this would wipe the code straight back to null.
    vi.setSystemTime(new Date('2026-07-22T10:00:31.000Z'))
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: true },
    ])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: null }])

    await store.refresh()

    expect(store.accounts[0].code).toBe('654321')

    // Once the period this code was revealed for actually ends, a refresh
    // should clear it back to "tap to reveal" like normal.
    vi.setSystemTime(new Date('2026-07-22T10:01:01.000Z'))
    await store.refresh()

    expect(store.accounts[0].code).toBeNull()
  })

  it('clears stale accounts before loading a different key, so state is never mixed between keys', async () => {
    useKeysStore().activeSerial = '11111111'
    vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z'))
    const store = useAccountsStore()
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: true },
    ])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: null }])
    await store.refresh()
    // Simulate the user having revealed a touch code on key #1 moments ago,
    // still within its validity window.
    store.accounts[0].code = '111111'
    store.accounts[0].codeExpiresAt = Date.now() + 20_000

    // Switching to a different key that happens to have an account with the
    // exact same issuer:name query, but a real, non-touch code.
    useKeysStore().activeSerial = '22222222'
    let resolveMetadata!: (v: OathAccount[]) => void
    vi.mocked(ykman.oathListAccounts).mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve
      }),
    )
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: '222222' }])
    const refreshPromise = store.refresh()

    // Before the new key's fetch even resolves, the old key's accounts must
    // already be gone - not lingering on screen as if they belonged to the
    // newly selected key.
    expect(store.accounts).toEqual([])

    resolveMetadata([
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false },
    ])
    await refreshPromise

    // The account must reflect key #2's real code, not key #1's stale
    // touch-revealed one that merge-by-query would otherwise carry over.
    expect(store.accounts).toEqual([
      {
        query: 'Service:user',
        issuer: 'Service',
        name: 'user',
        period: 30,
        touchRequired: false,
        code: '222222',
        codeExpiresAt: null,
      },
    ])
  })

  it('refreshCodes merges live codes without re-fetching metadata', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false },
    ])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: '111111' }])
    const store = useAccountsStore()
    await store.refresh()
    expect(ykman.oathListAccounts).toHaveBeenCalledTimes(1)

    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: '222222' }])
    await store.refreshCodes()

    expect(ykman.oathListAccounts).toHaveBeenCalledTimes(1) // still just the one full refresh above
    expect(store.accounts).toEqual([
      {
        query: 'Service:user',
        issuer: 'Service',
        name: 'user',
        period: 30,
        touchRequired: false,
        code: '222222',
        codeExpiresAt: null,
      },
    ])
  })

  it('refreshCodes does nothing if the active key differs from the loaded one', async () => {
    useKeysStore().activeSerial = '11111111'
    const store = useAccountsStore()
    store.loadedSerial = '22222222'

    await store.refreshCodes()

    expect(ykman.oathGetCodes).not.toHaveBeenCalled()
  })

  it('schedules a codes-only refresh at the next period boundary when an account is not touch-required', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.setSystemTime(new Date('2026-07-22T10:00:29.000Z')) // 1s to the next 30s boundary
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false },
    ])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: '111111' }])
    const store = useAccountsStore()

    await store.startAutoRefresh()
    expect(store.refreshHandle).not.toBeNull()

    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: '222222' }])
    await vi.advanceTimersByTimeAsync(1000)

    expect(store.accounts[0].code).toBe('222222')
    expect(ykman.oathListAccounts).toHaveBeenCalledTimes(1) // only the initial full refresh, not the periodic tick
    store.stopAutoRefresh()
  })

  it('never schedules a periodic refresh when every account is touch-required', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: true },
    ])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: null }])
    const store = useAccountsStore()

    await store.startAutoRefresh()

    expect(store.refreshHandle).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ykman.oathGetCodes).toHaveBeenCalledTimes(1) // only the initial full refresh's fetch
  })

  it('stops the periodic loop once a mutation leaves every remaining account touch-required', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z'))
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([
      { query: 'Service:user', issuer: 'Service', name: 'user', period: 30, touchRequired: false },
    ])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([{ query: 'Service:user', code: '111111' }])
    const store = useAccountsStore()
    await store.startAutoRefresh()
    expect(store.refreshHandle).not.toBeNull()

    vi.mocked(ykman.oathListAccounts).mockResolvedValue([])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([])
    await store.remove('Service:user')

    expect(store.refreshHandle).toBeNull()
  })

  it('rename calls ykman and refreshes', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([])
    const store = useAccountsStore()

    await store.rename('Service:user', 'Service', 'new-name')

    expect(ykman.oathRename).toHaveBeenCalledWith('36705123', 'Service:user', 'Service', 'new-name', null)
    expect(ykman.oathListAccounts).toHaveBeenCalled() // refreshed
  })

  it('remove calls ykman and refreshes', async () => {
    useKeysStore().activeSerial = '36705123'
    vi.mocked(ykman.oathListAccounts).mockResolvedValue([])
    vi.mocked(ykman.oathGetCodes).mockResolvedValue([])
    const store = useAccountsStore()

    await store.remove('Service:user')

    expect(ykman.oathDelete).toHaveBeenCalledWith('36705123', 'Service:user', null)
    expect(ykman.oathListAccounts).toHaveBeenCalled()
  })
})
