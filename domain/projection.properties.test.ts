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
import { addDays } from './dates'
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
        // A transfer dated past the window's end legitimately changes nothing
        // that is visible, so only in-window ones are required to show.
        const lastDay = after.days.at(-1) ?? WINDOW_START
        const landsInWindow = moving.some((transfer) => transfer.date <= lastDay)
        if (landsInWindow) expect(changed).toBe(true)
      }),
    )
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
