import { describe, expect, it } from 'vitest'
import type { DesiredOccurrence, MaterializationWindow } from '~~/domain/materialization'
import type { RecurringItem } from '~~/domain/types'
import {
  type SelectedOccurrenceRow,
  type SettledAmountRow,
  toOccurrenceOverride,
  toOverrideArgs,
  toRegenerationArgs,
  toRevertArgs,
  toSplitArgs,
  withSettledHistory,
} from './occurrences'

const window: MaterializationWindow = { start: '2026-06-05', end: '2027-09-03' }

const occurrence = (over: Partial<DesiredOccurrence> = {}): DesiredOccurrence => ({
  ruleId: 'rule-1',
  date: '2026-08-20',
  amount: -90_000,
  ...over,
})

describe('toRegenerationArgs', () => {
  it('carries the window straight through', () => {
    const args = toRegenerationArgs(['rule-1'], window, [])
    expect(args.p_window_start).toBe('2026-06-05')
    expect(args.p_window_end).toBe('2027-09-03')
  })

  it('unzips the desired set into three parallel, index-aligned arrays', () => {
    const desired = [
      occurrence({ ruleId: 'a', date: '2026-08-01', amount: -1_000 }),
      occurrence({ ruleId: 'b', date: '2026-08-02', amount: 2_000 }),
    ]
    const args = toRegenerationArgs(['a', 'b'], window, desired)

    expect(args.p_occurrence_rule_ids).toEqual(['a', 'b'])
    expect(args.p_occurrence_dates).toEqual(['2026-08-01', '2026-08-02'])
    expect(args.p_occurrence_amount_cents).toEqual([-1_000, 2_000])
  })

  it('de-duplicates p_rule_ids', () => {
    const args = toRegenerationArgs(['a', 'a', 'b'], window, [])
    expect(args.p_rule_ids).toEqual(['a', 'b'])
  })

  it('copies amounts through with no arithmetic — already signed by the caller', () => {
    const desired = [occurrence({ amount: -12_345 })]
    expect(toRegenerationArgs(['rule-1'], window, desired).p_occurrence_amount_cents).toEqual([
      -12_345,
    ])
  })

  it('handles an empty desired set — all three arrays empty, ruleIds still carried', () => {
    const args = toRegenerationArgs(['rule-1'], window, [])
    expect(args.p_occurrence_rule_ids).toEqual([])
    expect(args.p_occurrence_dates).toEqual([])
    expect(args.p_occurrence_amount_cents).toEqual([])
    expect(args.p_rule_ids).toEqual(['rule-1'])
  })

  it('handles an empty rule scope — an empty p_rule_ids array, not null', () => {
    const args = toRegenerationArgs([], window, [])
    expect(args.p_rule_ids).toEqual([])
  })

  it('every offered date falls inside the window it is paired with', () => {
    const desired = [
      occurrence({ date: window.start }),
      occurrence({ date: window.end }),
      occurrence({ date: '2026-12-25' }),
    ]
    const args = toRegenerationArgs(['rule-1'], window, desired)
    for (const date of args.p_occurrence_dates) {
      expect(date >= window.start && date <= window.end).toBe(true)
    }
  })
})

const row = (over: Partial<SelectedOccurrenceRow> = {}): SelectedOccurrenceRow => ({
  rule_id: 'rule-1',
  projected_date: '2026-08-20',
  projected_amount_cents: -90_000,
  actual_date: null,
  actual_amount_cents: -85_000,
  status: 'projected',
  is_overridden: true,
  ...over,
})

describe('toOccurrenceOverride', () => {
  it('maps rule_id to itemId and projected_date to date, scope always once', () => {
    const override = toOccurrenceOverride(row())
    expect(override.itemId).toBe('rule-1')
    expect(override.date).toBe('2026-08-20')
    expect(override.scope).toBe('once')
  })

  it('prefers actual_amount_cents over projected_amount_cents, with no arithmetic', () => {
    const override = toOccurrenceOverride(row({ actual_amount_cents: -70_000 }))
    expect(override.amount).toBe(-70_000)
  })

  it('falls back to projected_amount_cents when actual_amount_cents is null', () => {
    const override = toOccurrenceOverride(row({ actual_amount_cents: null }))
    expect(override.amount).toBe(-90_000)
  })

  it('omits newDate when actual_date is null — absent, not undefined', () => {
    const override = toOccurrenceOverride(row({ actual_date: null }))
    expect('newDate' in override).toBe(false)
  })

  it('carries actual_date through as newDate when set', () => {
    const override = toOccurrenceOverride(row({ actual_date: '2026-08-22' }))
    expect(override.newDate).toBe('2026-08-22')
  })
})

describe('toOverrideArgs', () => {
  it('keys the write on projectedDate, never the post-override date', () => {
    const args = toOverrideArgs({
      itemId: 'rule-1',
      date: '2026-08-20',
      amount: -85_000,
      projectedAmount: -90_000,
    })
    expect(args.p_rule_id).toBe('rule-1')
    expect(args.p_projected_date).toBe('2026-08-20')
    expect(args.p_projected_amount_cents).toBe(-90_000)
    expect(args.p_actual_amount_cents).toBe(-85_000)
  })

  it('passes null for p_actual_date when newDate is omitted — "on projected_date"', () => {
    const args = toOverrideArgs({
      itemId: 'rule-1',
      date: '2026-08-20',
      amount: -85_000,
      projectedAmount: -90_000,
    })
    expect(args.p_actual_date).toBeNull()
  })

  it('carries newDate through as p_actual_date when given', () => {
    const args = toOverrideArgs({
      itemId: 'rule-1',
      date: '2026-08-20',
      amount: -85_000,
      projectedAmount: -90_000,
      newDate: '2026-08-22',
    })
    expect(args.p_actual_date).toBe('2026-08-22')
  })
})

describe('toRevertArgs', () => {
  it('carries the rule id and date straight through', () => {
    const args = toRevertArgs('rule-1', '2026-08-20')
    expect(args).toEqual({ p_rule_id: 'rule-1', p_projected_date: '2026-08-20' })
  })
})

describe('toSplitArgs', () => {
  it('carries itemId, effectiveFrom and a positive amount straight through', () => {
    const args = toSplitArgs({ itemId: 'rule-1', effectiveFrom: '2026-09-01', amount: 175_000 })
    expect(args).toEqual({
      p_rule_id: 'rule-1',
      p_effective_from: '2026-09-01',
      p_amount_cents: 175_000,
    })
  })
})

describe('withSettledHistory (#18)', () => {
  const rule = (over: Partial<RecurringItem> = {}): RecurringItem => ({
    id: 'pay',
    name: 'Paycheck',
    kind: 'income',
    amount: 200_000,
    cadence: 'biweekly',
    accountId: 'acct',
    nextOccurrence: '2026-08-21',
    amountSource: 'predicted',
    depositHistory: [],
    isVariable: false,
    ...over,
  })
  const settled = (over: Partial<SettledAmountRow> = {}): SettledAmountRow => ({
    rule_id: 'pay',
    projected_date: '2026-08-07',
    actual_amount_cents: 245_000,
    ...over,
  })

  it('leaves every item untouched when there is no history — the common case at launch', () => {
    const items = [rule()]
    expect(withSettledHistory(items, [], 3)).toEqual(items)
    expect(withSettledHistory(items, null, 3)).toEqual(items)
  })

  it('attaches each rule its own settled amounts, oldest first, whatever order they arrive in', () => {
    const [pay, rent] = withSettledHistory(
      [rule(), rule({ id: 'rent', kind: 'bill', amountSource: 'fixed', isVariable: true })],
      [
        settled({ projected_date: '2026-08-21', actual_amount_cents: 250_000 }),
        settled({ rule_id: 'rent', projected_date: '2026-08-01', actual_amount_cents: -14_000 }),
        settled({ projected_date: '2026-08-07', actual_amount_cents: 240_000 }),
      ],
      3,
    )
    expect(pay?.depositHistory).toEqual([240_000, 250_000])
    // A bill's settled amount is signed negative; history holds magnitudes.
    expect(rent?.depositHistory).toEqual([14_000])
  })

  it('applies the window even if the function returned more than it should have', () => {
    const rows = ['2026-06-01', '2026-06-15', '2026-07-01', '2026-07-15'].map((date, index) =>
      settled({ projected_date: date, actual_amount_cents: (index + 1) * 100_000 }),
    )
    const [pay] = withSettledHistory([rule()], rows, 2)
    expect(pay?.depositHistory).toEqual([300_000, 400_000])
  })

  it('drops an amount whose sign contradicts the rule, and ignores rows for unknown rules', () => {
    const [pay] = withSettledHistory(
      [rule()],
      [
        settled({ actual_amount_cents: -5_000 }),
        settled({ rule_id: 'someone-elses-rule', actual_amount_cents: 999_999 }),
      ],
      3,
    )
    expect(pay?.depositHistory).toEqual([])
  })
})
