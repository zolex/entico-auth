import { describe, it, expect } from 'vitest'
import { computeOathDiff, type KeyAccounts } from '../oathDiff'

function account(query: string, issuer: string | null, name: string) {
  return { query, issuer, name, period: 30, touchRequired: false }
}

describe('computeOathDiff', () => {
  it('returns nothing when every key has the same accounts', () => {
    const keys: KeyAccounts[] = [
      { serial: 'A', keyName: 'Key A', accounts: [account('Service:user', 'Service', 'user')] },
      { serial: 'B', keyName: 'Key B', accounts: [account('Service:user', 'Service', 'user')] },
    ]
    expect(computeOathDiff(keys)).toEqual([])
  })

  it('flags an account missing from one key, listing only that key', () => {
    const keys: KeyAccounts[] = [
      { serial: 'A', keyName: 'Key A', accounts: [account('Service:user', 'Service', 'user')] },
      { serial: 'B', keyName: 'Key B', accounts: [] },
    ]
    const result = computeOathDiff(keys)
    expect(result).toEqual([
      {
        query: 'Service:user',
        issuer: 'Service',
        name: 'user',
        period: 30,
        touchRequired: false,
        missingFrom: [{ serial: 'B', keyName: 'Key B' }],
        presentFrom: [{ serial: 'A', keyName: 'Key A' }],
      },
    ])
  })

  it('lists every key that does have the account under presentFrom', () => {
    const keys: KeyAccounts[] = [
      { serial: 'A', keyName: 'Key A', accounts: [account('Service:user', 'Service', 'user')] },
      { serial: 'B', keyName: 'Key B', accounts: [account('Service:user', 'Service', 'user')] },
      { serial: 'C', keyName: 'Key C', accounts: [] },
    ]
    const result = computeOathDiff(keys)
    expect(result[0].presentFrom).toEqual([
      { serial: 'A', keyName: 'Key A' },
      { serial: 'B', keyName: 'Key B' },
    ])
  })

  it('sorts results by issuer/name', () => {
    const keys: KeyAccounts[] = [
      {
        serial: 'A',
        keyName: 'Key A',
        accounts: [account('Zeta:user', 'Zeta', 'user'), account('Alpha:user', 'Alpha', 'user')],
      },
      { serial: 'B', keyName: 'Key B', accounts: [] },
    ]
    const result = computeOathDiff(keys)
    expect(result.map((r) => r.issuer)).toEqual(['Alpha', 'Zeta'])
  })
})
