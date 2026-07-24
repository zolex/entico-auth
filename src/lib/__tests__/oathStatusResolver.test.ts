import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveOathStatus } from '../oathStatusResolver'

describe('resolveOathStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns unprotected when the key has no password', async () => {
    const client = { oathStatus: vi.fn().mockResolvedValue({ passwordProtected: false, remembered: false }) }

    const result = await resolveOathStatus('123', client)

    expect(result).toEqual({ kind: 'unprotected' })
  })

  it('returns locked immediately when protected and not remembered, without running any other ykman command', async () => {
    const client = { oathStatus: vi.fn().mockResolvedValue({ passwordProtected: true, remembered: false }) }

    const result = await resolveOathStatus('123', client)

    expect(result).toEqual({ kind: 'locked' })
    expect(client.oathStatus).toHaveBeenCalledTimes(1)
  })

  it('returns remembered when protected and oath info reports ykman already remembers the password', async () => {
    const client = { oathStatus: vi.fn().mockResolvedValue({ passwordProtected: true, remembered: true }) }

    const result = await resolveOathStatus('123', client)

    expect(result).toEqual({ kind: 'remembered' })
    expect(client.oathStatus).toHaveBeenCalledTimes(1)
  })

  it('returns oath-disabled immediately without retrying', async () => {
    const client = { oathStatus: vi.fn().mockRejectedValue({ kind: 'OathDisabled' }) }

    const result = await resolveOathStatus('123', client)

    expect(result).toEqual({ kind: 'oath-disabled' })
    expect(client.oathStatus).toHaveBeenCalledTimes(1)
  })

  it('retries a transient status failure and recovers', async () => {
    const client = {
      oathStatus: vi
        .fn()
        .mockRejectedValueOnce({ kind: 'NoKeyConnected' })
        .mockRejectedValueOnce({ kind: 'NoKeyConnected' })
        .mockResolvedValueOnce({ passwordProtected: true, remembered: false }),
    }

    const promise = resolveOathStatus('123', client, { retries: 3, retryDelayMs: 1000 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ kind: 'locked' })
    expect(client.oathStatus).toHaveBeenCalledTimes(3)
  })

  it('gives up and returns unknown after exhausting retries', async () => {
    const client = { oathStatus: vi.fn().mockRejectedValue({ kind: 'NoKeyConnected' }) }

    const promise = resolveOathStatus('123', client, { retries: 2, retryDelayMs: 1000 })
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ kind: 'unknown' })
    expect(client.oathStatus).toHaveBeenCalledTimes(3)
  })
})
