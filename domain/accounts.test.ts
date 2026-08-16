import { describe, expect, it } from 'vitest'
import {
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
    expect(result.filter((entry) => entry.isDiscretionarySource).map((entry) => entry.id)).toEqual(['b'])
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
