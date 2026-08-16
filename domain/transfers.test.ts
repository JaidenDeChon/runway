import { describe, expect, it } from 'vitest'
import { toMinorUnits } from './money'
import { createSeedData } from './seed'
import {
  canSubmitTransfer,
  resolveCounterAccount,
  sortTransfers,
  validateTransfer,
} from './transfers'
import type { Transfer } from './types'

describe('validateTransfer', () => {
  it('accepts a well-formed draft', () => {
    expect(validateTransfer({ fromAccountId: 'a', toAccountId: 'b', amount: 1 })).toEqual([])
    expect(canSubmitTransfer({ fromAccountId: 'a', toAccountId: 'b', amount: 1 })).toBe(true)
  })

  it('rejects a transfer to the same account', () => {
    expect(validateTransfer({ fromAccountId: 'a', toAccountId: 'a', amount: 1 })).toContain(
      'same-account',
    )
  })

  it('rejects a zero or negative amount', () => {
    expect(validateTransfer({ fromAccountId: 'a', toAccountId: 'b', amount: 0 })).toContain(
      'non-positive-amount',
    )
    expect(validateTransfer({ fromAccountId: 'a', toAccountId: 'b', amount: -5 })).toContain(
      'non-positive-amount',
    )
  })

  it('reports every problem at once rather than one at a time', () => {
    expect(validateTransfer({ fromAccountId: 'a', toAccountId: 'a', amount: 0 })).toHaveLength(2)
  })
})

describe('resolveCounterAccount', () => {
  const { accounts } = createSeedData()

  it('picks the first account that differs', () => {
    expect(resolveCounterAccount(accounts, 'acct-checking')).toBe('acct-savings')
  })

  it('returns null when there is nowhere else to move money', () => {
    expect(resolveCounterAccount(accounts.slice(0, 1), 'acct-checking')).toBeNull()
  })
})

describe('sortTransfers', () => {
  const transfer = (id: string, date: string, createdAt: number): Transfer => ({
    id,
    fromAccountId: 'a',
    toAccountId: 'b',
    amount: toMinorUnits(1),
    date,
    createdAt,
  })

  it('orders by date descending', () => {
    const sorted = sortTransfers([
      transfer('old', '2026-07-18', 1),
      transfer('new', '2026-08-01', 2),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['new', 'old'])
  })

  it('places a back-dated entry by its date, not by when it was entered', () => {
    const sorted = sortTransfers([
      transfer('existing', '2026-08-01', 1),
      transfer('backdated', '2026-06-01', 99),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['existing', 'backdated'])
  })

  it('breaks same-day ties by creation order, newest first', () => {
    const sorted = sortTransfers([
      transfer('first', '2026-08-01', 1),
      transfer('second', '2026-08-01', 2),
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['second', 'first'])
  })

  it('does not mutate its input', () => {
    const input = [transfer('a', '2026-07-01', 1), transfer('b', '2026-08-01', 2)]
    sortTransfers(input)
    expect(input.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})
