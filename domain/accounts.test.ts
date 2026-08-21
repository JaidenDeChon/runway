import { describe, expect, it } from 'vitest'
import {
  applyBalanceReadings,
  balanceReadings,
  countDependents,
  deleteAccount,
  nextAccountColor,
  setDiscretionarySource,
  upsertAccount,
} from './accounts'
import { toMinorUnits } from './money'
import { createSeedData } from './seed'
import type { Account } from './types'

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a',
  name: 'A',
  balance: toMinorUnits(100),
  balanceAsOf: '2026-08-15',
  color: 'chart-3',
  isDiscretionarySource: false,
  ...over,
})

describe('setDiscretionarySource', () => {
  it('clears the flag on every other account', () => {
    const result = setDiscretionarySource(
      [account({ id: 'a', isDiscretionarySource: true }), account({ id: 'b' })],
      'b',
    )
    expect(result.map((entry) => entry.isDiscretionarySource)).toEqual([false, true])
  })
})

describe('upsertAccount', () => {
  it('re-establishes exclusivity when an edit claims the flag', () => {
    const result = upsertAccount(
      [account({ id: 'a', isDiscretionarySource: true }), account({ id: 'b' })],
      account({ id: 'b', isDiscretionarySource: true }),
    )
    expect(result.filter((entry) => entry.isDiscretionarySource).map((entry) => entry.id)).toEqual([
      'b',
    ])
  })

  it('allows no account to hold the flag', () => {
    // Turning it off must not silently hand it to someone else.
    const result = upsertAccount(
      [account({ id: 'a', isDiscretionarySource: true })],
      account({ id: 'a', isDiscretionarySource: false }),
    )
    expect(result.some((entry) => entry.isDiscretionarySource)).toBe(false)
  })

  it('appends an account it has not seen before', () => {
    const result = upsertAccount([account({ id: 'a' })], account({ id: 'b' }))
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})

describe('nextAccountColor', () => {
  it('round-robins over the three assignable slots', () => {
    expect(nextAccountColor([])).toBe('chart-2')
    expect(nextAccountColor([account(), account()])).toBe('chart-4')
    expect(nextAccountColor([account(), account(), account()])).toBe('chart-2')
  })
})

describe('deleteAccount', () => {
  it('takes dependent items and transfers with it rather than orphaning them', () => {
    const seeded = createSeedData()
    const result = deleteAccount(
      seeded.accounts,
      seeded.recurringItems,
      seeded.transfers,
      'acct-checking',
    )
    expect(result.accounts.map((entry) => entry.id)).toEqual(['acct-savings'])
    expect(result.recurringItems.every((entry) => entry.accountId !== 'acct-checking')).toBe(true)
    expect(result.transfers).toEqual([])
  })

  it('counts what would be lost, for the confirmation copy', () => {
    const seeded = createSeedData()
    expect(countDependents(seeded.recurringItems, seeded.transfers, 'acct-savings')).toEqual({
      items: 2,
      transfers: 2,
    })
  })
})

describe('balanceReadings', () => {
  const at = (id: string, asOf: string): Account => ({
    id,
    name: id,
    balance: toMinorUnits(100),
    balanceAsOf: asOf,
    color: 'chart-2',
    isDiscretionarySource: false,
  })

  it('calls no accounts consistent rather than undefined', () => {
    const readings = balanceReadings([])
    expect(readings.isConsistent).toBe(true)
    expect(readings.newest).toBeNull()
    expect(readings.stale).toEqual([])
  })

  it('calls a single account consistent with itself', () => {
    expect(balanceReadings([at('a', '2026-08-15')]).isConsistent).toBe(true)
  })

  it('is consistent when every account was read on the same day', () => {
    const readings = balanceReadings([at('a', '2026-08-15'), at('b', '2026-08-15')])
    expect(readings.isConsistent).toBe(true)
    expect(readings.spreadDays).toBe(0)
    expect(readings.newest).toBe('2026-08-15')
  })

  it('names the accounts that are behind, and by how much', () => {
    const readings = balanceReadings([
      at('fresh', '2026-08-15'),
      at('week', '2026-08-08'),
      at('month', '2026-07-16'),
    ])
    expect(readings.isConsistent).toBe(false)
    expect(readings.newest).toBe('2026-08-15')
    expect(readings.oldest).toBe('2026-07-16')
    expect(readings.spreadDays).toBe(30)
    // Furthest behind first: that is the one the user should look at.
    expect(readings.stale).toEqual([
      { accountId: 'month', asOf: '2026-07-16', daysBehind: 30 },
      { accountId: 'week', asOf: '2026-08-08', daysBehind: 7 },
    ])
  })

  it('measures staleness against the newest reading, not against today', () => {
    // Both readings are ancient. They still agree, so nothing is stale — what
    // breaks a projection is readings that disagree, not readings that are old.
    const readings = balanceReadings([at('a', '2020-01-01'), at('b', '2020-01-01')])
    expect(readings.isConsistent).toBe(true)
  })
})

describe('applyBalanceReadings', () => {
  const accounts: Account[] = [
    {
      id: 'a',
      name: 'A',
      balance: toMinorUnits(100),
      balanceAsOf: '2026-08-01',
      color: 'chart-2',
      isDiscretionarySource: true,
    },
    {
      id: 'b',
      name: 'B',
      balance: toMinorUnits(200),
      balanceAsOf: '2026-08-10',
      color: 'chart-3',
      isDiscretionarySource: false,
    },
  ]

  it('records the balance and the day it was read', () => {
    const next = applyBalanceReadings(accounts, [{ accountId: 'a', balance: 4242 }], '2026-08-15')
    expect(next[0]).toMatchObject({ id: 'a', balance: 4242, balanceAsOf: '2026-08-15' })
  })

  it('leaves an account nobody reported alone', () => {
    const next = applyBalanceReadings(accounts, [{ accountId: 'a', balance: 1 }], '2026-08-15')
    expect(next[1]).toEqual(accounts[1])
  })

  it('brings the readings into agreement when every account is reported', () => {
    const next = applyBalanceReadings(
      accounts,
      accounts.map((account) => ({ accountId: account.id, balance: account.balance })),
      '2026-08-15',
    )
    expect(balanceReadings(next).isConsistent).toBe(true)
  })

  it('ignores a reading for an account that no longer exists', () => {
    // A sync that arrives after a deletion must not resurrect the account.
    const next = applyBalanceReadings(accounts, [{ accountId: 'gone', balance: 999 }], '2026-08-15')
    expect(next).toEqual(accounts)
  })

  it('preserves every other field, including the discretionary flag', () => {
    const next = applyBalanceReadings(accounts, [{ accountId: 'a', balance: 7 }], '2026-08-15')
    expect(next[0]?.isDiscretionarySource).toBe(true)
    expect(next[0]?.color).toBe('chart-2')
    expect(next[0]?.name).toBe('A')
  })
})
