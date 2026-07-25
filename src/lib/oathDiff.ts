import type { OathAccount } from './types'

export interface KeyAccounts {
  serial: string
  keyName: string
  accounts: OathAccount[]
}

export interface MissingFromKey {
  serial: string
  keyName: string
}

export interface MismatchedAccount {
  query: string
  issuer: string | null
  name: string
  period: number
  touchRequired: boolean
  missingFrom: MissingFromKey[]
  presentFrom: MissingFromKey[]
}

// Matches accounts across keys by `query` ("Issuer:name"), which is derived
// from the account label, not the secret - so the same account added
// separately to two keys still matches here. Only keys present in
// `keyAccounts` count: a key that couldn't be read (locked, oath-disabled,
// ...) is simply absent from the comparison rather than making every other
// account look "missing" from it.
export function computeOathDiff(keyAccounts: KeyAccounts[]): MismatchedAccount[] {
  const byQuery = new Map<
    string,
    { issuer: string | null; name: string; period: number; touchRequired: boolean; presentOn: Set<string> }
  >()
  for (const ka of keyAccounts) {
    for (const a of ka.accounts) {
      let entry = byQuery.get(a.query)
      if (!entry) {
        entry = { issuer: a.issuer, name: a.name, period: a.period, touchRequired: a.touchRequired, presentOn: new Set() }
        byQuery.set(a.query, entry)
      }
      entry.presentOn.add(ka.serial)
    }
  }

  const result: MismatchedAccount[] = []
  for (const [query, entry] of byQuery) {
    const missingFrom = keyAccounts
      .filter((ka) => !entry.presentOn.has(ka.serial))
      .map((ka) => ({ serial: ka.serial, keyName: ka.keyName }))
    if (missingFrom.length > 0) {
      const presentFrom = keyAccounts
        .filter((ka) => entry.presentOn.has(ka.serial))
        .map((ka) => ({ serial: ka.serial, keyName: ka.keyName }))
      result.push({
        query,
        issuer: entry.issuer,
        name: entry.name,
        period: entry.period,
        touchRequired: entry.touchRequired,
        missingFrom,
        presentFrom,
      })
    }
  }
  return result.sort((a, b) => (a.issuer ?? a.name).localeCompare(b.issuer ?? b.name))
}
