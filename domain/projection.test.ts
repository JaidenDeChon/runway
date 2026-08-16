import { describe, expect, it } from 'vitest'
import { addDays, daysBetween } from './dates'
import { toMinorUnits } from './money'
import {
  classifyMargin,
  evaluate,
  findLowestPoint,
  occurrencesIn,
  project,
  signedAmount,
  TIGHT_THRESHOLD,
  upcomingBills,
} from './projection'
import { createSeedData, SEED_TODAY } from './seed'
import type { Account, RecurringItem, RunwayData, Transfer } from './types'

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a',
  name: 'A',
  balance: toMinorUnits(1000),
  balanceAsOf: SEED_TODAY,
  color: 'chart-3',
  isDiscretionarySource: false,
  ...over,
})

const item = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'i',
  name: 'Item',
  kind: 'bill',
  amount: toMinorUnits(100),
  cadence: 'monthly',
  accountId: 'a',
  nextOccurrence: '2026-08-20',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
  ...over,
})

const data = (over: Partial<RunwayData> = {}): RunwayData => ({
  accounts: [account()],
  recurringItems: [],
  transfers: [],
  dailyDiscretionarySpend: 0,
  safetyCushion: 0,
  ...over,
})

describe('signedAmount', () => {
  it('is positive for income and negative for a bill, both from a positive stored magnitude', () => {
    expect(signedAmount(item({ kind: 'income', amount: toMinorUnits(500) }))).toBe(
      toMinorUnits(500),
    )
    expect(signedAmount(item({ kind: 'bill', amount: toMinorUnits(500) }))).toBe(toMinorUnits(-500))
  })
})

describe('project', () => {
  it('holds the balance flat when nothing is scheduled', () => {
    const result = project(data(), { start: SEED_TODAY, end: addDays(SEED_TODAY, 3) })
    expect(result.combined.map((point) => point.balance)).toEqual([
      toMinorUnits(1000),
      toMinorUnits(1000),
      toMinorUnits(1000),
      toMinorUnits(1000),
    ])
  })

  it('treats the as-of reading as already including that day', () => {
    // A bill on the as-of date itself must not be deducted a second time.
    const result = project(data({ recurringItems: [item({ nextOccurrence: SEED_TODAY })] }), {
      start: SEED_TODAY,
      end: SEED_TODAY,
    })
    expect(result.combined[0]?.balance).toBe(toMinorUnits(1000))
  })

  it('subtracts bills and adds income on their occurrence days', () => {
    const result = project(
      data({
        recurringItems: [
          item({ id: 'bill', nextOccurrence: addDays(SEED_TODAY, 1) }),
          item({
            id: 'pay',
            kind: 'income',
            amount: toMinorUnits(250),
            nextOccurrence: addDays(SEED_TODAY, 2),
          }),
        ],
      }),
      { start: SEED_TODAY, end: addDays(SEED_TODAY, 2) },
    )
    expect(result.combined.map((point) => point.balance)).toEqual([
      toMinorUnits(1000),
      toMinorUnits(900),
      toMinorUnits(1150),
    ])
  })

  it('integrates backwards for days before the as-of reading', () => {
    // Yesterday's balance must be *higher* than today's when a bill landed
    // today — walking backwards subtracts the delta rather than adding it.
    const result = project(data({ recurringItems: [item({ nextOccurrence: SEED_TODAY })] }), {
      start: addDays(SEED_TODAY, -2),
      end: SEED_TODAY,
    })
    expect(result.combined.map((point) => point.balance)).toEqual([
      toMinorUnits(1100),
      toMinorUnits(1100),
      toMinorUnits(1000),
    ])
  })

  it('drains the daily discretionary spend from the source account only', () => {
    const result = project(
      data({
        accounts: [
          account({ id: 'a', isDiscretionarySource: true }),
          account({ id: 'b', balance: toMinorUnits(500) }),
        ],
        dailyDiscretionarySpend: toMinorUnits(10),
      }),
      { start: SEED_TODAY, end: addDays(SEED_TODAY, 2) },
    )
    const [source, other] = result.byAccount
    expect(source?.points.map((point) => point.balance)).toEqual([
      toMinorUnits(1000),
      toMinorUnits(990),
      toMinorUnits(980),
    ])
    expect(other?.points.every((point) => point.balance === toMinorUnits(500))).toBe(true)
  })

  it('restricts the projection to the requested accounts', () => {
    const result = project(
      data({ accounts: [account({ id: 'a' }), account({ id: 'b', balance: toMinorUnits(7) })] }),
      { start: SEED_TODAY, end: SEED_TODAY, accountIds: ['b'] },
    )
    expect(result.byAccount).toHaveLength(1)
    expect(result.combined[0]?.balance).toBe(toMinorUnits(7))
  })
})

describe('transfers are balance-neutral', () => {
  it('leaves the combined series identical', () => {
    const transfer: Transfer = {
      id: 't',
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: toMinorUnits(400),
      date: addDays(SEED_TODAY, 1),
      createdAt: 1,
    }
    const accounts = [account({ id: 'a' }), account({ id: 'b', balance: toMinorUnits(500) })]
    const window = { start: SEED_TODAY, end: addDays(SEED_TODAY, 2) }

    const without = project(data({ accounts }), window)
    const with_ = project(data({ accounts, transfers: [transfer] }), window)

    expect(with_.combined).toEqual(without.combined)
  })

  it('still moves the individual account balances', () => {
    const transfer: Transfer = {
      id: 't',
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: toMinorUnits(400),
      date: addDays(SEED_TODAY, 1),
      createdAt: 1,
    }
    const result = project(
      data({
        accounts: [account({ id: 'a' }), account({ id: 'b', balance: toMinorUnits(500) })],
        transfers: [transfer],
      }),
      { start: SEED_TODAY, end: addDays(SEED_TODAY, 1) },
    )
    expect(result.byAccount[0]?.points[1]?.balance).toBe(toMinorUnits(600))
    expect(result.byAccount[1]?.points[1]?.balance).toBe(toMinorUnits(900))
  })

  it('never registers as income or spending', () => {
    const result = occurrencesIn(
      data({
        transfers: [
          {
            id: 't',
            fromAccountId: 'a',
            toAccountId: 'b',
            amount: toMinorUnits(400),
            date: SEED_TODAY,
            createdAt: 1,
          },
        ],
      }),
      { start: SEED_TODAY, end: SEED_TODAY },
    )
    expect(result).toEqual([])
  })
})

describe('findLowestPoint', () => {
  const points = [
    { date: '2026-08-15', balance: 10 },
    { date: '2026-08-16', balance: 50 },
    { date: '2026-08-17', balance: 30 },
    { date: '2026-08-18', balance: 30 },
  ]

  it('ignores today by default, because the verdict is about what is coming', () => {
    expect(findLowestPoint(points)).toEqual({ date: '2026-08-17', balance: 30 })
  })

  it('includes today when explicitly asked', () => {
    expect(findLowestPoint(points, { from: 0 })).toEqual({ date: '2026-08-15', balance: 10 })
  })

  it('resolves ties to the earliest date', () => {
    expect(findLowestPoint(points)?.date).toBe('2026-08-17')
  })

  it('returns null when there is no future to search', () => {
    expect(findLowestPoint([{ date: '2026-08-15', balance: 1 }])).toBeNull()
  })
})

describe('classifyMargin', () => {
  it('treats the $250 boundary as covered, not tight', () => {
    expect(classifyMargin(TIGHT_THRESHOLD)).toBe('covered')
    expect(classifyMargin(TIGHT_THRESHOLD - 1)).toBe('tight')
  })

  it('treats exactly meeting the cushion as tight, not short', () => {
    expect(classifyMargin(0)).toBe('tight')
    expect(classifyMargin(-1)).toBe('short')
  })
})

describe('evaluate', () => {
  it('reports the shortfall as a negative margin', () => {
    const verdict = evaluate(
      [
        { date: '2026-08-15', balance: toMinorUnits(5000) },
        { date: '2026-08-16', balance: toMinorUnits(4886) },
      ],
      toMinorUnits(6000),
    )
    expect(verdict.status).toBe('short')
    expect(verdict.isCovered).toBe(false)
    expect(verdict.margin).toBe(toMinorUnits(-1114))
  })
})

describe('upcomingBills', () => {
  const seeded = createSeedData()

  it('excludes income', () => {
    expect(upcomingBills(seeded, SEED_TODAY).some((bill) => bill.label === 'Paycheck')).toBe(false)
  })

  it('lists only the next occurrence of each bill', () => {
    const bills = upcomingBills(seeded, SEED_TODAY)
    expect(new Set(bills.map((bill) => bill.itemId)).size).toBe(bills.length)
  })

  it('respects the horizon', () => {
    expect(upcomingBills(seeded, SEED_TODAY, 6).map((bill) => bill.label)).toEqual(['Car payment'])
  })

  it('excludes today, so every bill is genuinely upcoming', () => {
    const bills = upcomingBills(seeded, SEED_TODAY)
    expect(bills.every((bill) => daysBetween(SEED_TODAY, bill.date) >= 1)).toBe(true)
  })

  it('is sorted by date ascending', () => {
    const dates = upcomingBills(seeded, SEED_TODAY).map((bill) => bill.date)
    expect([...dates].sort()).toEqual(dates)
  })
})
