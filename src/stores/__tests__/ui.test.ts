import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from '../ui'
import { nextBoundaryMs } from '../../lib/totp-timing'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useUiStore', () => {
  it('starts locked', () => {
    expect(useUiStore().locked).toBe(true)
  })

  it('unlock() clears locked, lock() sets it', () => {
    const store = useUiStore()
    store.unlock()
    expect(store.locked).toBe(false)
    store.lock()
    expect(store.locked).toBe(true)
  })

  it('lock() forgets every key\'s session password', () => {
    const store = useUiStore()
    store.setSessionPassword('111', 'hunter2')
    store.setSessionPassword('222', 'hunter3')
    store.lock()
    expect(store.sessionPasswordFor('111')).toBeNull()
    expect(store.sessionPasswordFor('222')).toBeNull()
  })

  it('clearSessionPassword() forgets one key\'s password without locking or touching other keys', () => {
    const store = useUiStore()
    store.unlock()
    store.setSessionPassword('111', 'hunter2')
    store.setSessionPassword('222', 'hunter3')
    store.clearSessionPassword('111')
    expect(store.sessionPasswordFor('111')).toBeNull()
    expect(store.sessionPasswordFor('222')).toBe('hunter3')
    expect(store.locked).toBe(false)
  })

  it('requireUnlock() locks without touching any stored passwords', () => {
    const store = useUiStore()
    store.unlock()
    store.setSessionPassword('111', 'hunter2')
    store.requireUnlock()
    expect(store.locked).toBe(true)
    expect(store.sessionPasswordFor('111')).toBe('hunter2')
  })
})

describe('scheduleClipboardClear', () => {
  it('clears the clipboard when the credential period elapses, only if it still holds that code', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText, readText: vi.fn().mockResolvedValue('123456') } })

    const store = useUiStore()
    const now = Date.now()
    const period = 30
    store.scheduleClipboardClear('123456', period)

    await vi.advanceTimersByTimeAsync(nextBoundaryMs(now, period) - now + 50)

    expect(writeText).toHaveBeenCalledWith('')
    vi.useRealTimers()
  })
})

describe('showToast', () => {
  it('sets toastMessage and clears it after the duration', async () => {
    vi.useFakeTimers()
    const store = useUiStore()
    store.showToast('Copied to clipboard', 500)
    expect(store.toastMessage).toBe('Copied to clipboard')

    await vi.advanceTimersByTimeAsync(500)
    expect(store.toastMessage).toBeNull()
    vi.useRealTimers()
  })

  it('replaces a pending toast timer when called again', async () => {
    vi.useFakeTimers()
    const store = useUiStore()
    store.showToast('first', 500)
    await vi.advanceTimersByTimeAsync(300)
    store.showToast('second', 500)
    await vi.advanceTimersByTimeAsync(300)
    expect(store.toastMessage).toBe('second')

    await vi.advanceTimersByTimeAsync(200)
    expect(store.toastMessage).toBeNull()
    vi.useRealTimers()
  })
})

describe('idle auto-lock', () => {
  it('locks after idleLockMinutes of no noteActivity() calls', async () => {
    vi.useFakeTimers()
    const store = useUiStore()
    store.unlock()
    store.idleLockMinutes = 1

    store.noteActivity()
    await vi.advanceTimersByTimeAsync(61_000)

    expect(store.locked).toBe(true)
    vi.useRealTimers()
  })

  it('does not lock when idleLockMinutes is null (default off)', async () => {
    vi.useFakeTimers()
    const store = useUiStore()
    store.unlock()

    store.noteActivity()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(store.locked).toBe(false)
    vi.useRealTimers()
  })
})
