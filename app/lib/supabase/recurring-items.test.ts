import { describe, expect, it } from 'vitest'
import type { RecurringItemDraft, RecurringRuleRow } from './recurring-items'
import { toRecurringItem, toRecurringRuleColumns } from './recurring-items'

const row = (over: Partial<RecurringRuleRow> = {}): RecurringRuleRow => ({
  id: 'rule-1',
  user_id: 'user-1',
  account_id: 'acct-1',
  name: 'Rent',
  kind: 'bill',
  amount_cents: 165_000,
  amount_source: 'fixed',
  is_variable: false,
  cadence: 'monthly',
  anchor_date: '2026-09-01',
  days_of_month: null,
  days_of_week: null,
  starts_on: null,
  ends_on: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
})

const draft = (over: Partial<RecurringItemDraft> = {}): RecurringItemDraft => ({
  name: 'Rent',
  kind: 'bill',
  amount: 165_000,
  cadence: 'monthly',
  accountId: 'acct-1',
  nextOccurrence: '2026-09-01',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
  ...over,
})

describe('toRecurringItem', () => {
  it('maps every column onto its domain field', () => {
    expect(toRecurringItem(row())).toEqual({
      id: 'rule-1',
      name: 'Rent',
      kind: 'bill',
      amount: 165_000,
      cadence: 'monthly',
      accountId: 'acct-1',
      nextOccurrence: '2026-09-01',
      amountSource: 'fixed',
      depositHistory: [],
      isVariable: false,
    })
  })

  it('maps anchor_date onto nextOccurrence — the names differ deliberately', () => {
    expect(toRecurringItem(row({ anchor_date: '2026-12-25' })).nextOccurrence).toBe('2026-12-25')
  })

  it('always reads depositHistory as empty — it is derived, not a column on this row', () => {
    expect(toRecurringItem(row({ amount_source: 'predicted' })).depositHistory).toEqual([])
  })

  it('round-trips amount_source: predicted', () => {
    expect(toRecurringItem(row({ kind: 'income', amount_source: 'predicted' })).amountSource).toBe(
      'predicted',
    )
  })

  it.each([
    ['days_of_month', 'daysOfMonth'],
    ['days_of_week', 'daysOfWeek'],
    ['starts_on', 'startsOn'],
    ['ends_on', 'endsOn'],
  ] as const)('maps a null %s to an absent %s, not to undefined', (column, field) => {
    const item = toRecurringItem(row({ [column]: null }))
    expect((item as unknown as Record<string, unknown>)[field]).toBeUndefined()
    expect(Object.hasOwn(item, field)).toBe(false)
  })

  it('maps a set days_of_month to the domain field, surviving a month-end marker', () => {
    expect(toRecurringItem(row({ days_of_month: [-1, 1] })).daysOfMonth).toEqual([-1, 1])
  })

  it('maps a set days_of_week to the domain field', () => {
    expect(toRecurringItem(row({ days_of_week: [1, 4] })).daysOfWeek).toEqual([1, 4])
  })

  it('maps set starts_on and ends_on to the domain fields', () => {
    const item = toRecurringItem(row({ starts_on: '2026-09-01', ends_on: '2026-12-31' }))
    expect(item.startsOn).toBe('2026-09-01')
    expect(item.endsOn).toBe('2026-12-31')
  })

  it('keeps amount_cents as the integer PostgREST returns, with no coercion', () => {
    expect(toRecurringItem(row({ amount_cents: 100 })).amount).toBe(100)
  })
})

describe('toRecurringRuleColumns', () => {
  it('maps a draft onto insert/update columns, leaving user_id to the caller', () => {
    expect(toRecurringRuleColumns(draft())).toEqual({
      account_id: 'acct-1',
      name: 'Rent',
      kind: 'bill',
      amount_cents: 165_000,
      amount_source: 'fixed',
      is_variable: false,
      cadence: 'monthly',
      anchor_date: '2026-09-01',
      days_of_month: null,
      days_of_week: null,
      starts_on: null,
      ends_on: null,
    })
  })

  it('maps an absent daysOfMonth/daysOfWeek/startsOn/endsOn to null, not undefined', () => {
    const columns = toRecurringRuleColumns(draft())
    expect(columns.days_of_month).toBeNull()
    expect(columns.days_of_week).toBeNull()
    expect(columns.starts_on).toBeNull()
    expect(columns.ends_on).toBeNull()
  })

  it('a monthly rule with daysOfMonth: [-1] survives the round trip', () => {
    const columns = toRecurringRuleColumns(draft({ daysOfMonth: [-1] }))
    expect(columns.days_of_month).toEqual([-1])
  })

  it('carries a set daysOfWeek, startsOn and endsOn through to columns', () => {
    const columns = toRecurringRuleColumns(
      draft({ daysOfWeek: [1, 4], startsOn: '2026-09-01', endsOn: '2026-12-31' }),
    )
    expect(columns.days_of_week).toEqual([1, 4])
    expect(columns.starts_on).toBe('2026-09-01')
    expect(columns.ends_on).toBe('2026-12-31')
  })

  it('round-trips amount_source: predicted for income', () => {
    const columns = toRecurringRuleColumns(draft({ kind: 'income', amountSource: 'predicted' }))
    expect(columns.kind).toBe('income')
    expect(columns.amount_source).toBe('predicted')
  })

  it('round-trips is_variable', () => {
    expect(toRecurringRuleColumns(draft({ isVariable: true })).is_variable).toBe(true)
  })
})

describe('editing a rule the form has no control for a field of', () => {
  // Regression test for a real bug: RecurringItemEditor.vue's onSave payload
  // omitted daysOfMonth/daysOfWeek/startsOn entirely, so toRecurringRuleColumns
  // mapped their absence to `null` and saveRecurringItem's UPDATE sent that
  // null on every save — silently clearing a field the editor has no UI for,
  // even when nothing about that field was touched. `B Paycheck`
  // (days_of_month {1,15}) went from semi-monthly to monthly-on-the-15th,
  // halving projected income, on one unrelated save.
  //
  // This pins the round-trip contract an editor MUST honour: read a row,
  // change one unrelated field, and the fields the form cannot show must
  // still reach the saved columns unchanged. Going row -> toRecurringItem ->
  // (the shape an edit-and-resave produces) -> toRecurringRuleColumns
  // exercises both mapping directions the same way a real edit does.
  it('a draft built from a semi-monthly rule, with only the name changed, still carries daysOfMonth and startsOn', () => {
    const original = toRecurringItem(
      row({
        name: 'B Paycheck',
        kind: 'income',
        amount_cents: 120_000,
        days_of_month: [1, 15],
        starts_on: '2026-01-01',
      }),
    )
    expect(original.daysOfMonth).toEqual([1, 15])
    expect(original.startsOn).toBe('2026-01-01')

    // Exactly the shape a correct editor builds on save: every field carried
    // through from the loaded item, with only `name` overridden.
    const resaved: RecurringItemDraft = {
      ...original,
      name: 'B Paycheck (renamed)',
    }

    const columns = toRecurringRuleColumns(resaved)
    expect(columns.days_of_month).toEqual([1, 15])
    expect(columns.starts_on).toBe('2026-01-01')
  })

  it('a draft built from a rule with daysOfWeek, with only the amount changed, still carries daysOfWeek', () => {
    const original = toRecurringItem(row({ cadence: 'weekly', days_of_week: [1, 4] }))
    expect(original.daysOfWeek).toEqual([1, 4])

    const resaved: RecurringItemDraft = { ...original, amount: 5_000 }

    expect(toRecurringRuleColumns(resaved).days_of_week).toEqual([1, 4])
  })
})
