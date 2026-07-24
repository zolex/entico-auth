import * as simpleIcons from 'simple-icons'

interface BrandIcon {
  title: string
  hex: string
  path: string
}

interface NormalizedIcon extends BrandIcon {
  normalized: string
}

const ICONS: NormalizedIcon[] = Object.values(
  simpleIcons as Record<string, { title: string; hex: string; path: string }>,
)
  .filter((icon) => !!icon?.title)
  .map((icon) => ({ ...icon, normalized: normalize(icon.title) }))

// Strips a single trailing TLD or legal-entity suffix (e.g. "Binance.com" -> "Binance",
// "Google LLC" -> "Google") so the exact-match pass below can still hit deterministically,
// without resorting to fuzzy matching for something this unambiguous.
const SUFFIX_RE =
  /\.(com|net|org|io|co|app|dev)$|\s+(inc|incorporated|llc|corp|corporation|ltd|limited|gmbh|plc|co)\.?$/i

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function stripSuffix(issuer: string): string {
  return issuer.trim().replace(SUFFIX_RE, '').trim()
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length][b.length]
}

function findExact(target: string): BrandIcon | null {
  const match = ICONS.find((icon) => icon.normalized === target)
  return match ? { title: match.title, hex: match.hex, path: match.path } : null
}

// Only accepts a distance-<=1 match, i.e. a single typo'd/missing/extra character. This runs
// after suffix stripping, so it never has to absorb suffix cruft itself - a looser threshold
// there produced same-score collisions between correct and incorrect matches (see icons.test.ts).
function findFuzzy(target: string): BrandIcon | null {
  if (target.length < 3) return null
  let best: NormalizedIcon | null = null
  let bestDist = Infinity
  for (const icon of ICONS) {
    if (icon.normalized.length < 3) continue
    if (Math.abs(icon.normalized.length - target.length) > 1) continue
    const dist = levenshtein(target, icon.normalized)
    if (dist < bestDist) {
      bestDist = dist
      best = icon
      if (dist === 0) break
    }
  }
  return best && bestDist <= 1 ? { title: best.title, hex: best.hex, path: best.path } : null
}

export function brandIconFor(issuer: string | null): BrandIcon | null {
  if (!issuer) return null

  const exact = findExact(normalize(issuer))
  if (exact) return exact

  const stripped = stripSuffix(issuer)
  if (stripped !== issuer) {
    const strippedExact = findExact(normalize(stripped))
    if (strippedExact) return strippedExact
  }

  return findFuzzy(normalize(stripped || issuer))
}

export function monogramFor(nameOrIssuer: string): string {
  return nameOrIssuer.trim().charAt(0).toUpperCase() || '?'
}
