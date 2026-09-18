/**
 * The projection engine's invariants, asserted over generated inputs.
 *
 * These are the four properties issue #4 names, and they are properties rather
 * than examples for a reason: each one is a statement about *every* possible
 * portfolio, and the failure they exist to catch is the one nobody thought to
 * write a fixture for. A single counterexample here is a real bug in the money.
 *
 * Generated accounts always carry a `balanceAsOf` at or before the window's
 * start, which is what a stored reading actually is — a fact about today or
 * some earlier day. It matters to the last two properties: the engine
 * integrates *backwards* from the as-of reading, so a bill dated before it
 * raises the earlier balances rather than lowering them, correctly, because the
 * stored balance already has that bill taken out of it.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addDays, compareDates } from './dates'
import type { DayPoint, Projection } from './projection'
import { project } from './projection'
import type { Account, RecurringItem, RunwayData, Transfer } from './types'

/** The window every generated case is projected over. Spans a leap day. */
const WINDOW_START = '2026-01-15'

const accountArb = (id: string): fc.Arbitrary<Account> =>
  fc
    .record({
      balance: fc.integer({ min: -200_000, max: 5_000_000 }),
      // At or before the window opens: a reading is a fact about a past day.
      asOfOffset: fc.integer({ min: -30, max: 0 }),
    })
    .map(({ balance, asOfOffset }) => ({
      id,
      name: id.toUpperCase(),
      balance,
      balanceAsOf: addDays(WINDOW_START, asOfOffset),
      color: 'chart-2' as const,
      // At most one, as `setDiscretionarySource` guarantees everywhere else.
      isDiscretionarySource: id === 'a',
    }))

const accountsArb: fc.Arbitrary<Account[]> = fc
  .tuple(accountArb('a'), accountArb('b'), accountArb('c'))
  .chain((all) => fc.integer({ min: 1, max: 3 }).map((count) => all.slice(0, count)))

const itemArb = (accountIds: readonly string[], index: number): fc.Arbitrary<RecurringItem> =>
  fc
    .record({
      kind: fc.constantFrom('bill', 'income'),
      amount: fc.integer({ min: 1, max: 400_000 }),
      cadence: fc.constantFrom('weekly', 'biweekly', 'monthly', 'annual'),
      anchorOffset: fc.integer({ min: -40, max: 150 }),
      accountId: fc.constantFrom(...accountIds),
      // -1 is month end; 29..31 exercise the February clamp.
      daysOfMonth: fc.option(
        fc.uniqueArray(fc.constantFrom(-1, 1, 15, 29, 31), { minLength: 1, maxLength: 3 }),
        { nil: undefined },
      ),
    })
    .map(({ kind, amount, cadence, anchorOffset, accountId, daysOfMonth }) => ({
      id: `item-${index}`,
      name: `Item ${index}`,
      kind,
      amount,
      cadence,
      accountId,
      nextOccurrence: addDays(WINDOW_START, anchorOffset),
      amountSource: 'fixed' as const,
      depositHistory: [],
      isVariable: false,
      ...(daysOfMonth ? { daysOfMonth } : {}),
    }))

/**
 * Transfers are dated strictly after the window opens, and every generated
 * `balanceAsOf` is at or before it, so a generated transfer always post-dates
 * every stored reading.
 *
 * That is a precondition of neutrality, not a convenience. A stored balance is
 * true *as of* its own day and already contains everything that happened up to
 * it, so a transfer between an account whose reading post-dates it and one
 * whose reading predates it is already counted on one side and not the other —
 * and the combined line legitimately moves. See the worked example in
 * `projection.test.ts`; it is a fact about stale readings, not about transfers.
 */
const transferArb = (accountIds: readonly string[], index: number): fc.Arbitrary<Transfer> =>
  fc
    .record({
      fromAccountId: fc.constantFrom(...accountIds),
      // Deliberately allowed to equal `from`. `validateTransfer` rejects that at
      // the form, but the engine must stay neutral about it regardless.
      toAccountId: fc.constantFrom(...accountIds),
      amount: fc.integer({ min: 1, max: 300_000 }),
      dayOffset: fc.integer({ min: 1, max: 150 }),
    })
    .map(({ fromAccountId, toAccountId, amount, dayOffset }) => ({
      id: `transfer-${index}`,
      fromAccountId,
      toAccountId,
      amount,
      date: addDays(WINDOW_START, dayOffset),
      createdAt: index,
    }))

const listOf = <T>(
  make: (accountIds: readonly string[], index: number) => fc.Arbitrary<T>,
  accountIds: readonly string[],
  max: number,
): fc.Arbitrary<T[]> =>
  fc
    .integer({ min: 0, max })
    .chain((count) =>
      count === 0
        ? fc.constant<T[]>([])
        : fc.tuple(...Array.from({ length: count }, (_, i) => make(accountIds, i))),
    )

const dataArb: fc.Arbitrary<RunwayData> = accountsArb.chain((accounts) => {
  const ids = accounts.map((account) => account.id)
  return fc
    .record({
      recurringItems: listOf(itemArb, ids, 6),
      transfers: listOf(transferArb, ids, 4),
      balanceHistory: fc.constant([]),
      monthlyDiscretionarySpend: fc.integer({ min: 0, max: 300_000 }),
      safetyCushion: fc.integer({ min: 0, max: 200_000 }),
      timeZone: fc.constant(null),
    })
    .map((rest) => ({ accounts, ...rest }))
})

/** Window lengths from a single day up to the 90-day horizon and past it. */
const windowLengthArb = fc.integer({ min: 0, max: 150 })

const balances = (points: readonly DayPoint[]): number[] => points.map((point) => point.balance)

const lowest = (projection: Projection): number => {
  const value = projection.combinedSummary.lowest?.balance
  if (value === undefined) throw new Error('every generated window has at least one day')
  return value
}

const projectOver = (data: RunwayData, length: number): Projection =>
  project(data, { start: WINDOW_START, end: addDays(WINDOW_START, length) })

/**
 * Whether these transfers actually displace some account's line somewhere
 * inside the window — the exact condition under which the individual series
 * are obliged to move.
 *
 * "A transfer lands in the window" is not that condition, which is what issue
 * #78 was: a pair of equal, opposite legs dated the same day is in the window
 * and moves nothing, because a transfer's effect on a line is cumulative from
 * its own day onward and the two cancel before any day is drawn. Self-transfers
 * are the other degenerate case, and the callers filter those out first.
 *
 * So this walks the in-window dates in order and asks, after each *whole* day
 * has been applied, whether any account is currently away from where it would
 * otherwise have been. The day boundary is the load-bearing part: legs that
 * cancel within one day never show, while legs that cancel a week apart
 * displace both accounts for that week and must.
 *
 * Transfers dated before the window opens are not considered, matching
 * `occurrencesIn`'s own skip — though the generator never produces one.
 */
function displacesAnyLine(transfers: readonly Transfer[], lastDay: string): boolean {
  const inWindow = transfers
    .filter(
      (transfer) =>
        compareDates(transfer.date, WINDOW_START) >= 0 && compareDates(transfer.date, lastDay) <= 0,
    )
    .sort((left, right) => compareDates(left.date, right.date))

  const net = new Map<string, number>()
  const move = (accountId: string, by: number): void => {
    net.set(accountId, (net.get(accountId) ?? 0) + by)
  }

  for (const [index, transfer] of inWindow.entries()) {
    move(transfer.fromAccountId, -transfer.amount)
    move(transfer.toAccountId, transfer.amount)
    // Mid-day: the rest of this day's legs may still cancel what this one did.
    if (inWindow[index + 1]?.date === transfer.date) continue
    for (const displacement of net.values()) if (displacement !== 0) return true
  }
  return false
}

describe('the combined series is the sum of the individual series', () => {
  it('holds for any portfolio', () => {
    fc.assert(
      fc.property(dataArb, windowLengthArb, (data, length) => {
        const projection = projectOver(data, length)
        for (let i = 0; i < projection.days.length; i++) {
          const summed = projection.byAccount.reduce(
            (total, series) => total + (series.points[i]?.balance ?? 0),
            0,
          )
          expect(projection.combined[i]?.balance).toBe(summed)
        }
      }),
    )
  })

  it('holds when the projection is narrowed to a subset of accounts', () => {
    fc.assert(
      fc.property(dataArb, windowLengthArb, (data, length) => {
        const accountIds = data.accounts.slice(0, 1).map((account) => account.id)
        const projection = project(data, {
          start: WINDOW_START,
          end: addDays(WINDOW_START, length),
          accountIds,
        })
        expect(projection.byAccount).toHaveLength(1)
        expect(balances(projection.combined)).toEqual(
          balances(projection.byAccount[0]?.points ?? []),
        )
      }),
    )
  })
})

describe('a transfer never moves the combined line', () => {
  it('holds for any set of transfers, when both legs are in view', () => {
    fc.assert(
      fc.property(dataArb, windowLengthArb, (data, length) => {
        const withoutTransfers = projectOver({ ...data, transfers: [] }, length)
        const withTransfers = projectOver(data, length)
        expect(balances(withTransfers.combined)).toEqual(balances(withoutTransfers.combined))
        expect(withTransfers.combinedSummary).toEqual(withoutTransfers.combinedSummary)
      }),
    )
  })

  it('still moves the individual lines it is between', () => {
    // The neutrality above must come from the two legs cancelling, not from the
    // engine quietly ignoring transfers.
    //
    // Asserted as an equivalence rather than a one-way implication, which is
    // what makes it airtight in both directions: the lines move exactly when
    // `displacesAnyLine` says they must, so neither a transfer the engine
    // forgot to apply nor one it applied that nothing asked for can pass.
    fc.assert(
      fc.property(dataArb, windowLengthArb, (data, length) => {
        const moving = data.transfers.filter(
          (transfer) => transfer.fromAccountId !== transfer.toAccountId,
        )
        fc.pre(moving.length > 0 && data.accounts.length > 1)
        const before = projectOver({ ...data, transfers: [] }, length)
        const after = projectOver({ ...data, transfers: moving }, length)
        const changed = after.byAccount.some((series, index) => {
          const original = before.byAccount[index]?.points ?? []
          return balances(series.points).some((value, day) => value !== original[day]?.balance)
        })
        expect(changed).toBe(displacesAnyLine(moving, after.days.at(-1) ?? WINDOW_START))
      }),
    )
  })

  // The shrunk counterexample from issue #78, kept as an example so the
  // degenerate shape stays covered whatever the generator happens to roll.
  // Two legs of equal size in opposite directions on one day: in the window,
  // between two different accounts, and yet nothing on either line moves.
  it('leaves the individual lines alone when same-day legs cancel exactly', () => {
    const data: RunwayData = {
      accounts: [
        {
          id: 'a',
          name: 'A',
          balance: 3_101_917,
          balanceAsOf: '2025-12-21',
          color: 'chart-2',
          isDiscretionarySource: true,
        },
        {
          id: 'b',
          name: 'B',
          balance: 4_051_796,
          balanceAsOf: '2025-12-19',
          color: 'chart-2',
          isDiscretionarySource: false,
        },
      ],
      recurringItems: [],
      transfers: [
        {
          id: 'transfer-1',
          fromAccountId: 'a',
          toAccountId: 'b',
          amount: 7,
          date: '2026-01-22',
          createdAt: 1,
        },
        {
          id: 'transfer-2',
          fromAccountId: 'b',
          toAccountId: 'a',
          amount: 7,
          date: '2026-01-22',
          createdAt: 2,
        },
      ],
      balanceHistory: [],
      monthlyDiscretionarySpend: 0,
      safetyCushion: 0,
      timeZone: null,
    }

    const before = projectOver({ ...data, transfers: [] }, 30)
    const after = projectOver(data, 30)

    for (const [index, series] of after.byAccount.entries()) {
      expect(balances(series.points)).toEqual(balances(before.byAccount[index]?.points ?? []))
    }
    // And the property's own expectation agrees that nothing was owed, which is
    // the part that used to be wrong rather than the engine.
    expect(displacesAnyLine(data.transfers, after.days.at(-1) ?? WINDOW_START)).toBe(false)
  })
})

describe('a bill never raises the projected minimum', () => {
  it('holds for any bill added to any portfolio', () => {
    fc.assert(
      fc.property(
        dataArb,
        windowLengthArb,
        fc.integer({ min: 0, max: 2 }),
        (data, length, pick) => {
          const accountId = data.accounts[pick % data.accounts.length]?.id ?? 'a'
          return fc.assert(
            fc.property(itemArb([accountId], 99), (extra) => {
              const bill: RecurringItem = { ...extra, kind: 'bill' }
              const before = lowest(projectOver(data, length))
              const after = lowest(
                projectOver({ ...data, recurringItems: [...data.recurringItems, bill] }, length),
              )
              expect(after).toBeLessThanOrEqual(before)
            }),
            { numRuns: 5 },
          )
        },
      ),
    )
  })
})

describe('income never lowers the projected minimum', () => {
  it('holds for any income added to any portfolio', () => {
    fc.assert(
      fc.property(
        dataArb,
        windowLengthArb,
        fc.integer({ min: 0, max: 2 }),
        (data, length, pick) => {
          const accountId = data.accounts[pick % data.accounts.length]?.id ?? 'a'
          return fc.assert(
            fc.property(itemArb([accountId], 99), (extra) => {
              const income: RecurringItem = { ...extra, kind: 'income' }
              const before = lowest(projectOver(data, length))
              const after = lowest(
                projectOver({ ...data, recurringItems: [...data.recurringItems, income] }, length),
              )
              expect(after).toBeGreaterThanOrEqual(before)
            }),
            { numRuns: 5 },
          )
        },
      ),
    )
  })
})

describe('a later reading never changes what an earlier one already produced', () => {
  it('holds for any portfolio and any pair of readings', () => {
    fc.assert(
      fc.property(
        dataArb,
        windowLengthArb,
        // Strictly after the window's start, so it lands inside the visible
        // series regardless of window length, and strictly after every
        // generated `balanceAsOf` (always at or before `WINDOW_START`).
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: -200_000, max: 5_000_000 }),
        (data, length, laterOffsetDays, laterBalance) => {
          const [first, ...restAccounts] = data.accounts
          if (!first) return
          const before = projectOver(data, length)

          const laterAsOf = addDays(WINDOW_START, laterOffsetDays)
          const layered: RunwayData = {
            ...data,
            accounts: [
              { ...first, balance: laterBalance, balanceAsOf: laterAsOf },
              ...restAccounts,
            ],
            balanceHistory: [
              ...data.balanceHistory,
              { accountId: first.id, balance: first.balance, asOf: first.balanceAsOf },
            ],
          }
          const after = projectOver(layered, length)

          const beforePoints = before.byAccount.find((s) => s.accountId === first.id)?.points ?? []
          const afterPoints = after.byAccount.find((s) => s.accountId === first.id)?.points ?? []
          for (const [index, point] of beforePoints.entries()) {
            if (compareDates(point.date, laterAsOf) >= 0) continue
            expect(afterPoints[index]?.balance).toBe(point.balance)
          }
        },
      ),
    )
  })
})

describe('balances are reported, not clamped', () => {
  it('lets the combined line go negative when the money runs out', () => {
    fc.assert(
      // At least one day past the window's start, so the bill below has a day to
      // land on that is not already inside a stored reading.
      fc.property(dataArb, fc.integer({ min: 1, max: 150 }), (data, length) => {
        // One ruinous bill, every month, on a portfolio of any shape. Dated the
        // day after the window opens: a bill landing *on* an account's as-of
        // reading is already inside that reading and must not be charged twice.
        const ruinous: RecurringItem = {
          id: 'ruinous',
          name: 'Ruinous',
          kind: 'bill',
          amount: 50_000_000,
          cadence: 'monthly',
          accountId: data.accounts[0]?.id ?? 'a',
          nextOccurrence: addDays(WINDOW_START, 1),
          amountSource: 'fixed',
          depositHistory: [],
          isVariable: false,
        }
        const projection = projectOver(
          { ...data, recurringItems: [...data.recurringItems, ruinous] },
          length,
        )
        expect(lowest(projection)).toBeLessThan(0)
      }),
    )
  })
})
