/**
 * The engine-boundary cases for stored occurrence overrides (issue #15),
 * kept in a separate file from `domain/overrides.test.ts` so they stay
 * findable: these are specifically about `occurrencesIn`'s window arithmetic,
 * not about `applyOne`/`applyOverrides` themselves.
 *
 * The real gap the issue's own warning pointed at: `occurrencesIn` expands
 * each rule over `[start, end]` *before* applying overrides, so an occurrence
 * retimed **from outside the window into it** would never be expanded in the
 * first place and its override would match nothing. These tests pin the fix
 * (widening the expansion range for a retime landing inside the window) and,
 * just as importantly, pin that the no-override case is byte-identical to
 * before it — a golden-fixture diff in `domain/golden.test.ts` after this
 * file's change would mean a behaviour change for the no-override case, which
 * is a bug to find, not a fixture to regenerate.
 */

import { describe, expect, it } from 'vitest'
import { toMinorUnits } from './money'
import type { StoredOccurrenceOverride } from './overrides'
import { occurrencesIn } from './projection'
import type { Account, RecurringItem, RunwayData } from './types'

const account: Account = {
  id: 'a',
  name: 'Checking',
  balance: toMinorUnits(1_000),
  balanceAsOf: '2026-08-01',
  color: 'chart-2',
  isDiscretionarySource: false,
}

const rentItem: RecurringItem = {
  id: 'i-rent',
  name: 'Rent',
  kind: 'bill',
  amount: toMinorUnits(500),
  cadence: 'monthly',
  accountId: 'a',
  nextOccurrence: '2026-08-01',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
}

function baseData(over: Partial<RunwayData> = {}): RunwayData {
  return {
    accounts: [account],
    recurringItems: [rentItem],
    transfers: [],
    balanceHistory: [],
    monthlyDiscretionarySpend: 0,
    safetyCushion: 0,
    timeZone: null,
    occurrenceOverrides: [],
    ...over,
  }
}

describe('occurrencesIn window arithmetic with stored overrides', () => {
  it('a retime landing outside the window makes no difference at all — the no-override pin', () => {
    const window = { start: '2026-08-05', end: '2026-08-25' }
    // Rent's only natural occurrence in range would be none: the anchor's
    // Aug 1 falls before the window, Sep 1 falls after it.
    expect(occurrencesIn(baseData(), window)).toEqual([])
  })

  it('a retime FROM outside the window INTO it is expanded and appears, with projectedDate/id keyed on the original day', () => {
    const window = { start: '2026-08-05', end: '2026-08-25' }
    const override: StoredOccurrenceOverride = {
      itemId: 'i-rent',
      date: '2026-08-01', // the rule's own day — outside [start, end]
      scope: 'once',
      amount: toMinorUnits(-550),
      newDate: '2026-08-10', // inside [start, end]
    }

    const occurrences = occurrencesIn(baseData({ occurrenceOverrides: [override] }), window)
    expect(occurrences).toHaveLength(1)
    const occurrence = occurrences[0]
    expect(occurrence?.date).toBe('2026-08-10')
    // The natural key half that never moves — half of occurrences'
    // (rule_id, projected_date) key, and the id built from it.
    expect(occurrence?.projectedDate).toBe('2026-08-01')
    expect(occurrence?.id).toBe('i-rent@2026-08-01')
    expect(occurrence?.amount).toBe(toMinorUnits(-550))
    expect(occurrence?.projectedAmount).toBe(toMinorUnits(-500))
    expect(occurrence?.isOverridden).toBe(true)
  })

  it('a retime FROM inside the window OUT of it removes the occurrence entirely — it does not linger at its old spot', () => {
    // Here the natural occurrence (Aug 1) already lands inside the window;
    // no widening is needed to see it before the override moves it away.
    const window = { start: '2026-07-25', end: '2026-08-15' }
    const override: StoredOccurrenceOverride = {
      itemId: 'i-rent',
      date: '2026-08-01',
      scope: 'once',
      amount: toMinorUnits(-550),
      newDate: '2026-09-05', // outside [start, end]
    }

    expect(occurrencesIn(baseData({ occurrenceOverrides: [override] }), window)).toEqual([])
  })

  it('with occurrenceOverrides: [] and no window.overrides, output is unchanged from the pre-override shape', () => {
    const window = { start: '2026-07-25', end: '2026-08-15' }
    const occurrences = occurrencesIn(baseData(), window)
    expect(occurrences).toEqual([
      expect.objectContaining({
        id: 'i-rent@2026-08-01',
        date: '2026-08-01',
        projectedDate: '2026-08-01',
        amount: toMinorUnits(-500),
        projectedAmount: toMinorUnits(-500),
        isOverridden: false,
        isSettled: false,
      }),
    ])
  })

  it('a stored override and a what-if future override on the same item layer saved-then-preview, later winning', () => {
    const window = { start: '2026-07-25', end: '2026-08-15' }
    const stored: StoredOccurrenceOverride = {
      itemId: 'i-rent',
      date: '2026-08-01',
      scope: 'once',
      amount: toMinorUnits(-550),
    }
    const preview = {
      itemId: 'i-rent',
      date: '2026-08-01',
      scope: 'future' as const,
      amount: toMinorUnits(-999),
    }

    const occurrences = occurrencesIn(baseData({ occurrenceOverrides: [stored] }), {
      ...window,
      overrides: [preview],
    })
    expect(occurrences).toHaveLength(1)
    // The preview, layered on top of the saved edit, wins.
    expect(occurrences[0]?.amount).toBe(toMinorUnits(-999))
    expect(occurrences[0]?.isOverridden).toBe(true)
  })
})
