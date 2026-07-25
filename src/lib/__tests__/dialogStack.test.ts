import { describe, it, expect } from 'vitest'
import { pushDialog, popDialog, isTopDialog } from '../dialogStack'

describe('dialogStack', () => {
  it('only the most recently pushed dialog is top', () => {
    const outer = Symbol()
    const inner = Symbol()
    pushDialog(outer)
    expect(isTopDialog(outer)).toBe(true)
    pushDialog(inner)
    expect(isTopDialog(outer)).toBe(false)
    expect(isTopDialog(inner)).toBe(true)
    popDialog(inner)
    expect(isTopDialog(outer)).toBe(true)
    popDialog(outer)
  })
})
