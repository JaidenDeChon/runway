/**
 * AC-A2 for `public.split_recurring_rule`
 * (issue #15, `supabase/migrations/20260913090000_occurrence_overrides_and_rule_split.sql`).
 *
 * "Apply to all future" closes the edited rule the day before the change and
 * opens a successor from the change date, rather than bulk-editing occurrence
 * rows (docs/database/schema.md, "Rule splitting"). This file proves the split
 * itself (columns, dates, in-place branch) and the two-call regeneration
 * dance `useRunwayData.ts`'s `splitRecurringItem` performs afterwards
 * (plan §4.2): the union of both rules' occurrence dates must equal
 * `occurrenceDates` for each rule, with no duplicate and no gap at the seam.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { occurrenceDates } from '~~/domain/cadence'
import { desiredOccurrences, materializationWindow } from '~~/domain/materialization'
import { toMinorUnits } from '~~/domain/money'
import type { RecurringItem } from '~~/domain/types'
import { type AuthContext, secondUserContext } from '../support/auth'
import { LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'rule-split'
const TODAY = '2026-09-03'

interface RuleRow {
  readonly id: string
  readonly account_id: string
  readonly name: string
  readonly kind: string
  readonly amount_cents: number
  readonly amount_source: string
  readonly is_variable: boolean
  readonly cadence: string
  readonly days_of_month: number[] | null
  readonly days_of_week: number[] | null
  readonly anchor_date: string
  readonly starts_on: string | null
  readonly ends_on: string | null
}

async function readRule(context: AuthContext, id: string): Promise<RuleRow> {
  const { data, error } = await context.client
    .from('recurring_rules')
    .select(
      'id, account_id, name, kind, amount_cents, amount_source, is_variable, cadence, days_of_month, days_of_week, anchor_date, starts_on, ends_on',
    )
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`could not read rule ${id}: ${error?.message}`)
  return data
}

async function occurrenceDatesFor(context: AuthContext, ruleId: string): Promise<string[]> {
  const { data, error } = await context.client
    .from('occurrences')
    .select('projected_date')
    .eq('rule_id', ruleId)
    .order('projected_date', { ascending: true })
  if (error) throw new Error(`could not read occurrences for ${ruleId}: ${error.message}`)
  return (data ?? []).map((row) => row.projected_date)
}

async function regenerate(
  context: AuthContext,
  ruleIds: readonly string[],
  window: { start: string; end: string },
  items: readonly RecurringItem[],
): Promise<{ upserted: number; deleted: number }> {
  const desired = desiredOccurrences(items, window)
  const { data, error } = await context.client.rpc('regenerate_occurrences', {
    p_rule_ids: [...ruleIds],
    p_window_start: window.start,
    p_window_end: window.end,
    p_occurrence_rule_ids: desired.map((d) => d.ruleId),
    p_occurrence_dates: desired.map((d) => d.date),
    p_occurrence_amount_cents: desired.map((d) => d.amount),
  })
  if (error) throw new Error(`regenerate_occurrences failed: ${error.message}`)
  return data?.[0] ?? { upserted: 0, deleted: 0 }
}

const baseItem = (id: string, over: Partial<RecurringItem> = {}): RecurringItem => ({
  id,
  name: 'fixture rule',
  kind: 'bill',
  amount: toMinorUnits(1_650),
  cadence: 'monthly',
  accountId: 'unused',
  nextOccurrence: '2026-08-01',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
  ...over,
})

describe.skipIf(LOCAL_STACK === null)('split_recurring_rule', () => {
  let context: AuthContext
  let caseIndex = 0

  async function seedRentRule(overs: { nextOccurrence?: string } = {}): Promise<{
    accountId: string
    ruleId: string
  }> {
    caseIndex += 1
    const household = await seedHousehold(context, {
      label: LABEL,
      accounts: [
        {
          id: 'a',
          name: `Split account ${caseIndex}`,
          balance: 0,
          balanceAsOf: TODAY,
          color: 'chart-3',
          isDiscretionarySource: false,
        },
      ],
      recurringItems: [
        {
          id: 'rent',
          name: `Rent ${caseIndex}`,
          kind: 'bill',
          amount: toMinorUnits(1_650),
          cadence: 'monthly',
          accountId: 'a',
          nextOccurrence: overs.nextOccurrence ?? '2026-08-01',
          amountSource: 'fixed',
          depositHistory: [],
          isVariable: false,
        },
      ],
    })
    return {
      accountId: household.accountIds.get('a') as string,
      ruleId: household.ruleIds.get('rent') as string,
    }
  }

  beforeAll(async () => {
    await removeFixtures(LABEL)
    context = await secondUserContext()
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeFixtures(LABEL)
  })

  it('closes the rule the day before effective_from and opens a successor inheriting the copied fields and the old ends_on', async () => {
    const { ruleId } = await seedRentRule()
    const effectiveFrom = '2026-09-01'
    const newAmount = toMinorUnits(1_750)

    const { data, error } = await context.client.rpc('split_recurring_rule', {
      p_rule_id: ruleId,
      p_effective_from: effectiveFrom,
      p_amount_cents: newAmount,
    })
    expect(error).toBeNull()
    const row = data?.[0]
    if (!row) throw new Error('split_recurring_rule returned no row')
    expect(row.closed_rule_id).toBe(ruleId)
    expect(row.successor_rule_id).not.toBeNull()
    const successorId = row.successor_rule_id as string

    const closed = await readRule(context, ruleId)
    expect(closed.ends_on).toBe('2026-08-31')
    // The closed rule's own amount is untouched — the split changes bounds, not the past amount.
    expect(closed.amount_cents).toBe(toMinorUnits(1_650))

    const successor = await readRule(context, successorId)
    expect(successor.starts_on).toBe(effectiveFrom)
    expect(successor.anchor_date).toBe(effectiveFrom)
    expect(successor.amount_cents).toBe(newAmount)
    expect(successor.account_id).toBe(closed.account_id)
    expect(successor.name).toBe(closed.name)
    expect(successor.kind).toBe(closed.kind)
    expect(successor.cadence).toBe(closed.cadence)
    // Inherits the *old* ends_on (null here — the seed rule was unbounded).
    expect(successor.ends_on).toBeNull()
  })

  it('AC-A2: the union of both rules occurrence dates matches occurrenceDates for each, no duplicate, no gap at the seam', async () => {
    const { ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    const effectiveFrom = '2026-09-01'
    const newAmount = toMinorUnits(1_750)
    const oldAmount = toMinorUnits(1_650)

    // Regenerate before the split, as the app would once the rule existed for a while.
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { amount: oldAmount })])

    const { data } = await context.client.rpc('split_recurring_rule', {
      p_rule_id: ruleId,
      p_effective_from: effectiveFrom,
      p_amount_cents: newAmount,
    })
    const successorId = data?.[0]?.successor_rule_id as string

    // Per plan §4.2: refresh (simulated here by reading the rules back), then
    // regenerate both ids in one call.
    const closedRule = await readRule(context, ruleId)
    const successorRule = await readRule(context, successorId)

    const closedItem: RecurringItem = baseItem(ruleId, {
      amount: closedRule.amount_cents,
      ...(closedRule.ends_on ? { endsOn: closedRule.ends_on } : {}),
    })
    const successorItem: RecurringItem = baseItem(successorId, {
      amount: successorRule.amount_cents,
      nextOccurrence: successorRule.anchor_date,
      ...(successorRule.starts_on ? { startsOn: successorRule.starts_on } : {}),
      ...(successorRule.ends_on ? { endsOn: successorRule.ends_on } : {}),
    })

    await regenerate(context, [ruleId, successorId], window, [closedItem, successorItem])

    const closedDates = await occurrenceDatesFor(context, ruleId)
    const successorDates = await occurrenceDatesFor(context, successorId)
    const combined = [...closedDates, ...successorDates].sort()

    expect(combined).toEqual([...new Set(combined)])
    expect(closedDates.every((date) => date < effectiveFrom)).toBe(true)
    expect(successorDates.every((date) => date >= effectiveFrom)).toBe(true)

    const expectedClosed = occurrenceDates(closedItem, window.start, window.end)
    const expectedSuccessor = occurrenceDates(successorItem, window.start, window.end)
    expect(closedDates).toEqual(expectedClosed)
    expect(successorDates).toEqual(expectedSuccessor)

    // Amounts: old-before, new-from.
    const { data: closedRows } = await context.client
      .from('occurrences')
      .select('projected_amount_cents')
      .eq('rule_id', ruleId)
    for (const row of closedRows ?? []) expect(row.projected_amount_cents).toBe(-oldAmount)
    const { data: successorRows } = await context.client
      .from('occurrences')
      .select('projected_amount_cents')
      .eq('rule_id', successorId)
    for (const row of successorRows ?? []) expect(row.projected_amount_cents).toBe(-newAmount)
  })

  it('an overridden row of the closed rule at a date >= effective_from survives regeneration and stays inert', async () => {
    const { ruleId, accountId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    const effectiveFrom = '2026-09-01'
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { amount: toMinorUnits(1_650) })])

    // Override a future occurrence of the closed rule before splitting.
    await context.client.rpc('override_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-10-01',
      p_projected_amount_cents: -toMinorUnits(1_650),
      p_actual_amount_cents: -toMinorUnits(1_700),
      p_actual_date: null as unknown as string,
    })

    const { data } = await context.client.rpc('split_recurring_rule', {
      p_rule_id: ruleId,
      p_effective_from: effectiveFrom,
      p_amount_cents: toMinorUnits(1_750),
    })
    const successorId = data?.[0]?.successor_rule_id as string

    const closedRule = await readRule(context, ruleId)
    const successorRule = await readRule(context, successorId)
    const closedItem = baseItem(ruleId, {
      amount: closedRule.amount_cents,
      ...(closedRule.ends_on ? { endsOn: closedRule.ends_on } : {}),
    })
    const successorItem = baseItem(successorId, {
      amount: successorRule.amount_cents,
      nextOccurrence: successorRule.anchor_date,
      ...(successorRule.starts_on ? { startsOn: successorRule.starts_on } : {}),
    })
    await regenerate(context, [ruleId, successorId], window, [closedItem, successorItem])

    // The overridden row on the closed rule at 2026-10-01 (>= effectiveFrom)
    // is protected — it survives even though the closed rule no longer
    // "produces" that date. It is inert: no code path expands the closed rule
    // past ends_on, so no money moves because of it. #26 decides its fate.
    const { data: ghost } = await context.client
      .from('occurrences')
      .select('projected_date, is_overridden, actual_amount_cents')
      .eq('rule_id', ruleId)
      .eq('projected_date', '2026-10-01')
      .maybeSingle()
    expect(ghost).not.toBeNull()
    expect(ghost?.is_overridden).toBe(true)
    expect(ghost?.actual_amount_cents).toBe(-toMinorUnits(1_700))

    void accountId
  })

  it("in-place branch: splitting on the rule's own first occurrence updates the rule and creates no successor", async () => {
    const { ruleId } = await seedRentRule({ nextOccurrence: '2026-08-01' })
    const newAmount = toMinorUnits(1_800)

    const { data, error } = await context.client.rpc('split_recurring_rule', {
      p_rule_id: ruleId,
      p_effective_from: '2026-08-01',
      p_amount_cents: newAmount,
    })
    expect(error).toBeNull()
    const row = data?.[0]
    expect(row?.closed_rule_id).toBeNull()
    expect(row?.successor_rule_id).toBe(ruleId)

    const rule = await readRule(context, ruleId)
    expect(rule.amount_cents).toBe(newAmount)
    expect(rule.ends_on).toBeNull()

    const { count } = await context.client
      .from('recurring_rules')
      .select('id', { count: 'exact', head: true })
      .eq('name', rule.name)
    expect(count).toBe(1)
  })

  it('rejects a non-positive amount with PT400', async () => {
    const { ruleId } = await seedRentRule()
    const { error } = await context.client.rpc('split_recurring_rule', {
      p_rule_id: ruleId,
      p_effective_from: '2026-09-01',
      p_amount_cents: 0,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT400')
  })

  it('rejects an unknown rule id with PT404', async () => {
    const { error } = await context.client.rpc('split_recurring_rule', {
      p_rule_id: '00000000-0000-4000-8000-000000000000',
      p_effective_from: '2026-09-01',
      p_amount_cents: toMinorUnits(1_000),
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT404')
  })

  it("rejects a change date past the rule's own ends_on with PT409", async () => {
    const { ruleId } = await seedRentRule()
    await context.client.from('recurring_rules').update({ ends_on: '2026-09-30' }).eq('id', ruleId)

    const { error } = await context.client.rpc('split_recurring_rule', {
      p_rule_id: ruleId,
      p_effective_from: '2026-10-15',
      p_amount_cents: toMinorUnits(1_700),
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT409')
  })
})
