import { describe, it, expect } from 'vitest'
import { nextBoundaryMs, progressFraction, phaseColor } from '../totp-timing'

describe('nextBoundaryMs', () => {
  it('rounds up to the next 30s boundary', () => {
    // 10:00:05 -> next boundary is 10:00:30
    const now = new Date('2026-07-22T10:00:05.000Z').getTime()
    const expected = new Date('2026-07-22T10:00:30.000Z').getTime()
    expect(nextBoundaryMs(now, 30)).toBe(expected)
  })

  it('returns the current time when already exactly on a boundary', () => {
    const now = new Date('2026-07-22T10:00:30.000Z').getTime()
    expect(nextBoundaryMs(now, 30)).toBe(now)
  })
})

describe('progressFraction', () => {
  it('is 1.0 right after a boundary and approaches 0 near the next one', () => {
    const boundary = new Date('2026-07-22T10:00:00.000Z').getTime()
    expect(progressFraction(boundary, 30)).toBeCloseTo(1.0, 5)
    expect(progressFraction(boundary + 29_000, 30)).toBeCloseTo(1 / 30, 5)
  })
})

describe('phaseColor', () => {
  it('is the primary brand color in the first half', () => {
    expect(phaseColor(0.9)).toBe('var(--color-primary)')
  })
  it('is the secondary brand color in the second half', () => {
    expect(phaseColor(0.4)).toBe('var(--color-secondary)')
  })
  it('is the secondary brand color exactly at the midpoint', () => {
    expect(phaseColor(0.5)).toBe('var(--color-secondary)')
  })
})
