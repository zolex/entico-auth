import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { autofocusSelect } from '../autofocus'

describe('autofocusSelect', () => {
  it('focuses and selects when the target supports both', async () => {
    const el = { focus: vi.fn(), select: vi.fn() }
    await autofocusSelect(ref(el))
    expect(el.focus).toHaveBeenCalled()
    expect(el.select).toHaveBeenCalled()
  })

  it('only focuses when the target has no select (e.g. a button)', async () => {
    const el = { focus: vi.fn() }
    await autofocusSelect(ref(el))
    expect(el.focus).toHaveBeenCalled()
  })

  it('is a no-op when the ref holds null or undefined', async () => {
    await expect(autofocusSelect(ref(null))).resolves.toBeUndefined()
    await expect(autofocusSelect(ref(undefined))).resolves.toBeUndefined()
  })

  it('reads ref.value only after nextTick, not the value at call time', async () => {
    // Regression: the caller may pass a ref that's still null/stale at the
    // moment of the call (e.g. a v-if-gated element that hasn't mounted
    // yet) and only gets populated once Vue's pending render flushes.
    const target = ref<{ focus: () => void } | null>(null)
    const el = { focus: vi.fn() }
    const promise = autofocusSelect(target)
    target.value = el
    await promise
    expect(el.focus).toHaveBeenCalled()
  })
})
