import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useKeysStore } from '../keys'
import { ykman } from '../../lib/ykman-client'

vi.mock('../../lib/ykman-client', () => ({
  ykman: { listKeys: vi.fn(), checkYkman: vi.fn(), getSettings: vi.fn(), setKeyName: vi.fn() },
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.mocked(ykman.getSettings).mockResolvedValue({ keyNames: {} } as unknown as Awaited<ReturnType<typeof ykman.getSettings>>)
})

afterEach(() => {
  vi.useRealTimers()
  // resetAllMocks (not clearAllMocks) so a persistent mockRejectedValue/
  // mockResolvedValue from one test doesn't leak into the next as the
  // fallback implementation once a test's queued *Once values run out.
  vi.resetAllMocks()
})

describe('useKeysStore', () => {
  it('checkOnce lists keys and auto-selects the sole connected key', async () => {
    vi.mocked(ykman.listKeys).mockResolvedValue([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
    const store = useKeysStore()

    await store.checkOnce()

    expect(store.keys).toEqual([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
    expect(store.activeSerial).toBe('36705123')
  })

  it('does not auto-select when multiple keys are connected', async () => {
    vi.mocked(ykman.listKeys).mockResolvedValue([
      { serial: '111', name: 'YubiKey A' },
      { serial: '222', name: 'YubiKey B' },
    ])
    const store = useKeysStore()

    await store.checkOnce()

    expect(store.activeSerial).toBeNull()
  })

  it('exposes ykmanMissing when list_keys rejects with NotFound', async () => {
    vi.mocked(ykman.listKeys).mockRejectedValue({ kind: 'NotFound' })
    const store = useKeysStore()

    await store.checkOnce()

    expect(store.ykmanMissing).toBe(true)
  })

  it('keeps the active serial across a transient NoKeyConnected failure', async () => {
    vi.mocked(ykman.listKeys).mockResolvedValueOnce([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
    const store = useKeysStore()
    await store.checkOnce()
    expect(store.activeSerial).toBe('36705123')

    // The key is still physically present; this call just lost a race for
    // exclusive CCID access against another ykman invocation (see the
    // process-global mutex comment in run_ykman) and should not be treated
    // as proof the key was removed.
    vi.mocked(ykman.listKeys).mockRejectedValueOnce({ kind: 'NoKeyConnected' })
    await store.checkOnce()

    expect(store.activeSerial).toBe('36705123')
    expect(store.keys).toEqual([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
  })

  it('checkOnce resolves true on success and false on failure, for retry logic to act on', async () => {
    vi.mocked(ykman.listKeys).mockResolvedValueOnce([])
    const store = useKeysStore()
    await expect(store.checkOnce()).resolves.toBe(true)

    vi.mocked(ykman.listKeys).mockRejectedValueOnce({ kind: 'NoKeyConnected' })
    await expect(store.checkOnce()).resolves.toBe(false)
  })

  describe('checkOnceWithRetry', () => {
    it('stops retrying as soon as a check succeeds', async () => {
      // A key that was just plugged in can briefly fail CCID enumeration
      // before Windows/ykman finish settling it.
      vi.mocked(ykman.listKeys)
        .mockRejectedValueOnce({ kind: 'NoKeyConnected' })
        .mockResolvedValueOnce([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
      const store = useKeysStore()

      const promise = store.checkOnceWithRetry({ retries: 3, retryDelayMs: 800 })
      await vi.runAllTimersAsync()
      await promise

      expect(ykman.listKeys).toHaveBeenCalledTimes(2)
      expect(store.activeSerial).toBe('36705123')
    })

    it('gives up after exhausting retries', async () => {
      vi.mocked(ykman.listKeys).mockRejectedValue({ kind: 'NoKeyConnected' })
      const store = useKeysStore()

      const promise = store.checkOnceWithRetry({ retries: 2, retryDelayMs: 100 })
      await vi.runAllTimersAsync()
      await promise

      expect(ykman.listKeys).toHaveBeenCalledTimes(3) // initial attempt + 2 retries
    })
  })

  describe('custom key names', () => {
    it('displays the persisted custom name instead of the device name', async () => {
      vi.mocked(ykman.getSettings).mockResolvedValue({
        keyNames: { '36705123': 'Work Key' },
      } as unknown as Awaited<ReturnType<typeof ykman.getSettings>>)
      vi.mocked(ykman.listKeys).mockResolvedValue([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
      const store = useKeysStore()

      await store.checkOnce()

      expect(store.keys).toEqual([{ serial: '36705123', name: 'Work Key' }])
    })

    it('setKeyName overrides the displayed name immediately, without re-listing', async () => {
      vi.mocked(ykman.listKeys).mockResolvedValue([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
      const store = useKeysStore()
      await store.checkOnce()

      await store.setKeyName('36705123', 'Work Key')

      expect(ykman.setKeyName).toHaveBeenCalledWith('36705123', 'Work Key')
      expect(store.keys).toEqual([{ serial: '36705123', name: 'Work Key' }])
    })

    it('setKeyName with an empty name reverts to the device name', async () => {
      vi.mocked(ykman.getSettings).mockResolvedValue({
        keyNames: { '36705123': 'Work Key' },
      } as unknown as Awaited<ReturnType<typeof ykman.getSettings>>)
      vi.mocked(ykman.listKeys).mockResolvedValue([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
      const store = useKeysStore()
      await store.checkOnce()

      await store.setKeyName('36705123', '  ')

      expect(ykman.setKeyName).toHaveBeenCalledWith('36705123', null)
      expect(store.keys).toEqual([{ serial: '36705123', name: 'YubiKey 5 NFC' }])
    })
  })
})
