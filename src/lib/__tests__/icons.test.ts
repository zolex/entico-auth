import { describe, it, expect } from 'vitest'
import { brandIconFor } from '../icons'

describe('brandIconFor', () => {
  it('matches a well-known issuer case-insensitively', () => {
    const icon = brandIconFor('Discord')
    expect(icon).not.toBeNull()
    expect(icon?.title.toLowerCase()).toBe('discord')
  })

  it('returns null for an unrecognized issuer', () => {
    expect(brandIconFor('Definitely Not A Real Brand Xyz123')).toBeNull()
  })

  it('returns null for a null issuer', () => {
    expect(brandIconFor(null)).toBeNull()
  })

  it('strips a trailing TLD to match', () => {
    const icon = brandIconFor('Binance.com')
    expect(icon?.title).toBe('Binance')
  })

  it('strips a trailing legal suffix to match', () => {
    expect(brandIconFor('Github Inc.')?.title).toBe('GitHub')
  })

  it('resolves the exact brand, not an unrelated same-distance sibling', () => {
    expect(brandIconFor('Google LLC')?.title).toBe('Google')
  })

  it('fuzzy-matches a single-character typo of a known brand', () => {
    expect(brandIconFor('Binanc')?.title).toBe('Binance')
  })

  it('does not fabricate an icon for a brand with none in the library', () => {
    expect(brandIconFor('Amazon')).toBeNull()
    expect(brandIconFor('AWS')).toBeNull()
  })
})
