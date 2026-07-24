export interface ParsedOtpauth {
  issuer: string | null
  name: string
  secret: string
  digits: number
  algorithm: string
  period: number
}

export function parseOtpauthUri(uri: string): ParsedOtpauth | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol !== 'otpauth:') return null

  const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  let issuer = url.searchParams.get('issuer')
  let name = label
  const sep = label.indexOf(':')
  if (sep !== -1) {
    if (!issuer) issuer = label.slice(0, sep)
    name = label.slice(sep + 1)
  }

  const secret = url.searchParams.get('secret')
  if (!secret) return null

  const digitsParam = url.searchParams.get('digits')
  const periodParam = url.searchParams.get('period')

  return {
    issuer: issuer || null,
    name,
    secret,
    digits: digitsParam ? parseInt(digitsParam, 10) : 6,
    algorithm: (url.searchParams.get('algorithm') || 'SHA1').toUpperCase(),
    period: periodParam ? parseInt(periodParam, 10) : 30,
  }
}
