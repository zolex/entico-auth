import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { ykman } from '../ykman-client'
import { PresenceCancelledError, requirePresence } from '../presence'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../ykman-client', () => ({
  ykman: { getSettings: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requirePresence', () => {
  it('resolves without calling verify_presence when the setting is off', async () => {
    vi.mocked(ykman.getSettings).mockResolvedValue({ requireHelloForWrites: false } as never)

    await expect(requirePresence()).resolves.toBeUndefined()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('resolves when the result is Verified', async () => {
    vi.mocked(ykman.getSettings).mockResolvedValue({ requireHelloForWrites: true } as never)
    vi.mocked(invoke).mockResolvedValue('Verified')

    await expect(requirePresence()).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('verify_presence')
  })

  it('resolves when the result is Unavailable', async () => {
    vi.mocked(ykman.getSettings).mockResolvedValue({ requireHelloForWrites: true } as never)
    vi.mocked(invoke).mockResolvedValue('Unavailable')

    await expect(requirePresence()).resolves.toBeUndefined()
  })

  it('throws PresenceCancelledError when the result is Denied', async () => {
    vi.mocked(ykman.getSettings).mockResolvedValue({ requireHelloForWrites: true } as never)
    vi.mocked(invoke).mockResolvedValue('Denied')

    await expect(requirePresence()).rejects.toBeInstanceOf(PresenceCancelledError)
  })
})
