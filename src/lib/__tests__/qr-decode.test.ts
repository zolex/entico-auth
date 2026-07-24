import { describe, it, expect, vi } from 'vitest'
import { decodeQrFromImageData } from '../qr-decode'
import jsQR from 'jsqr'

vi.mock('jsqr', () => ({ default: vi.fn() }))

describe('decodeQrFromImageData', () => {
  it('returns the decoded text when jsQR finds a code', () => {
    vi.mocked(jsQR).mockReturnValue({ data: 'otpauth://totp/Service:user?secret=ABC' } as any)
    const imageData = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData
    expect(decodeQrFromImageData(imageData)).toBe('otpauth://totp/Service:user?secret=ABC')
  })

  it('returns null when no code is found', () => {
    vi.mocked(jsQR).mockReturnValue(null)
    const imageData = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData
    expect(decodeQrFromImageData(imageData)).toBeNull()
  })
})
