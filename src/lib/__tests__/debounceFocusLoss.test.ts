import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounceFocusLoss } from '../debounceFocusLoss'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('debounceFocusLoss', () => {
  it('reports a focus gain immediately', () => {
    const onChange = vi.fn()
    const setFocused = debounceFocusLoss(onChange, 250)

    setFocused(true)

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('suppresses a brief lost/regained blip, like the spurious pair Windows fires on any titlebar mousedown', async () => {
    const onChange = vi.fn()
    const setFocused = debounceFocusLoss(onChange, 250)
    setFocused(true)
    onChange.mockClear()

    setFocused(false)
    await vi.advanceTimersByTimeAsync(50)
    setFocused(true)
    await vi.advanceTimersByTimeAsync(250)

    expect(onChange).not.toHaveBeenCalledWith(false)
  })

  it('reports a real, sustained focus loss once the debounce window elapses', async () => {
    const onChange = vi.fn()
    const setFocused = debounceFocusLoss(onChange, 250)
    setFocused(true)
    onChange.mockClear()

    setFocused(false)
    await vi.advanceTimersByTimeAsync(250)

    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('restarts the debounce window on repeated blips instead of firing early', async () => {
    const onChange = vi.fn()
    const setFocused = debounceFocusLoss(onChange, 250)
    setFocused(true)
    onChange.mockClear()

    setFocused(false)
    await vi.advanceTimersByTimeAsync(200)
    setFocused(false) // a second blip's own lost edge, restarting the timer
    await vi.advanceTimersByTimeAsync(200)

    expect(onChange).not.toHaveBeenCalledWith(false)

    await vi.advanceTimersByTimeAsync(50)
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
