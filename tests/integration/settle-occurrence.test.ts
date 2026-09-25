/**
 * Issue #26's manual half — the `settle_occurrence` / `unsettle_occurrence`
 * RPC contract (`supabase/migrations/20260925010000_settle_occurrence.sql`),
 * against the live local stack.
 *
 * Drives the RPCs directly, with the argument shapes the app's own
 * `toSettleArgs` / `toUnsettleArgs` build, the way
 * `occurrence-overrides.test.ts` drives `override_occurrence`. What it pins:
 *
 *  - settling writes `status = 'confirmed'` and the actual figures, on a
 *    materialized row (update branch, `projected_*` untouched) and on a date
 *    that was never materialized (insert branch);
 *  - a settled row is exactly what `recent_settled_amounts()` reads, so it
 *    moves the estimate the app computes through `withSettledHistory` and
 *    `resolveAmount` — the "estimates learn from it" promise, end to end;
 *  - the refusals: PT400 for a sign that contradicts the rule's kind or a
 *    missing date, PT404 for an unknown rule, PT409 for a second settle and
 *    for `override_occurrence` / `revert_occurrence` against a settled row;
 *  - a confirmed row survives a `regenerate_occurrences` run that no longer
 *    desires it, while an unprotected sibling in the same run does not;
 *  - unsettling returns the row to `projected`, clearing the actuals unless
 *    the row had been hand-edited before it was settled, with PT409 for a
 *    row that is not settled and PT404 for one that does not exist.
 *
 * Runs under `secondUserContext()` (user B) for the reason
 * `occurrence-overrides.test.ts` gives: A and C are
 * `tests/rls/seed-fidelity.test.ts`'s exact-list fixtures. Every row goes in
 * through B's own session (CLAUDE.md, "Seed fixtures go in through a user's
 * own session"). Cross-user isolation for both functions is
 * `tests/rls/occurrence-editing-isolation.test.ts`'s job.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toSettleArgs, toUnsettleArgs, withSettledHistory } from '~~/app/lib/supabase/occurrences'
import { RECURRING_RULE_COLUMNS, toRecurringItem } from '~~/app/lib/supabase/recurring-items'
import type { IsoDate } from '~~/domain/dates'
import { desiredOccurrences, materializationWindow } from '~~/domain/materialization'
import { type MinorUnits, toMinorUnits } from '~~/domain/money'
import { resolveAmount } from '~~/domain/prediction'
import type { RecurringItem } from '~~/domain/types'
import { type AuthContext, secondUserContext } from '../support/auth'
import { LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'settle-occurrence'
const TODAY = '2026-09-03'

interface Seeded {
  readonly accountId: string
  readonly ruleId: string
  readonly item: RecurringItem
}

interface OccurrenceRow {
  readonly id: string
  readonly projected_date: string
  readonly projected_amount_cents: number
  readonly actual_amount_cents: number | null
  readonly actual_date: string | null
  readonly status: string
  readonly is_overridden: boolean
}

const paycheck = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'rule',
  name: 'Paycheck',
  kind: 'income',
  amount: toMinorUnits(2_000),
  cadence: 'biweekly',
  accountId: 'a',
  nextOccurrence: '2026-06-05',
  amountSource: 'predicted',
  depositHistory: [],
  isVariable: false,
  ...over,
})

const rent = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'rule',
  name: 'Rent',
  kind: 'bill',
  amount: toMinorUnits(900),
  cadence: 'monthly',
  accountId: 'a',
  nextOccurrence: '2026-08-20',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
  ...over,
})

async function occurrenceAt(
  context: AuthContext,
  ruleId: string,
  date: string,
): Promise<OccurrenceRow | null> {
  const { data, error } = await context.client
    .from('occurrences')
    .select(
      'id, projected_date, projected_amount_cents, actual_amount_cents, actual_date, status, is_overridden',
    )
    .eq('rule_id', ruleId)
    .eq('projected_date', date)
    .maybeSingle()
  if (error) throw new Error(`could not read the occurrence: ${error.message}`)
  return data
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

async function recentSettled(context: AuthContext) {
  const { data, error } = await context.client.rpc('recent_settled_amounts')
  if (error) throw new Error(`recent_settled_amounts failed: ${error.message}`)
  return data ?? []
}

async function setWindow(context: AuthContext, window: number) {
  return context.client
    .from('user_settings')
    .update({ prediction_window: window })
    .eq('user_id', context.userId as string)
}

/** The estimate the app would project for `ruleId`, computed exactly the way `useRunwayData` does. */
async function projectedEstimate(context: AuthContext, ruleId: string): Promise<number> {
  const [{ data: rules, error: rulesError }, rows, { data: settings, error: settingsError }] =
    await Promise.all([
      context.client.from('recurring_rules').select(RECURRING_RULE_COLUMNS).eq('id', ruleId),
      recentSettled(context),
      context.client.from('user_settings').select('prediction_window').maybeSingle(),
    ])
  if (rulesError) throw new Error(`could not read the rule: ${rulesError.message}`)
  if (settingsError) throw new Error(`could not read settings: ${settingsError.message}`)
  const items = withSettledHistory(
    (rules ?? []).map(toRecurringItem),
    rows,
    settings?.prediction_window ?? 3,
  )
  const [item] = items
  if (!item) throw new Error(`rule ${ruleId} is not visible to its own owner`)
  return resolveAmount(item)
}

describe.skipIf(LOCAL_STACK === null)('settle_occurrence / unsettle_occurrence (#26)', () => {
  let context: AuthContext
  let caseIndex = 0
  let originalWindow = 3

  /** One fresh account + rule per test, optionally materialized across `materializationWindow(TODAY)`. */
  async function seedRule(item: RecurringItem, materialize = false): Promise<Seeded> {
    caseIndex += 1
    const household = await seedHousehold(context, {
      label: LABEL,
      accounts: [
        {
          id: 'a',
          name: `Checking ${caseIndex}`,
          balance: toMinorUnits(1_000),
          balanceAsOf: TODAY,
          color: 'chart-2',
          isDiscretionarySource: false,
        },
      ],
      recurringItems: [{ ...item, name: `${item.name} ${caseIndex}` }],
      ...(materialize ? { materializeOccurrences: materializationWindow(TODAY) } : {}),
    })
    const accountId = household.accountIds.get('a') as string
    const ruleId = household.ruleIds.get('rule') as string
    return { accountId, ruleId, item: { ...item, id: ruleId, accountId } }
  }

  function settle(
    ruleId: string,
    date: IsoDate,
    amount: MinorUnits,
    projectedAmount: MinorUnits,
    actualDate: IsoDate,
  ) {
    return context.client.rpc(
      'settle_occurrence',
      toSettleArgs({ itemId: ruleId, date, amount, projectedAmount, actualDate }),
    )
  }

  function unsettle(ruleId: string, date: IsoDate) {
    return context.client.rpc('unsettle_occurrence', toUnsettleArgs(ruleId, date))
  }

  beforeAll(async () => {
    await removeFixtures(LABEL)
    context = await secondUserContext()
    const { data } = await context.client
      .from('user_settings')
      .select('prediction_window')
      .eq('user_id', context.userId as string)
      .single()
    originalWindow = data?.prediction_window ?? 3
    const { error } = await setWindow(context, 3)
    if (error) throw new Error(`could not reset the window: ${error.message}`)
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await setWindow(context, originalWindow)
    await removeFixtures(LABEL)
  })

  it('settles a materialized row: confirmed, with the actuals, and projected_* left exactly as they were', async () => {
    const { ruleId } = await seedRule(paycheck(), true)
    const before = await occurrenceAt(context, ruleId, '2026-06-19')
    if (!before) throw new Error('materialized row missing before settle')
    expect(before.status).toBe('projected')

    // A projected amount that disagrees with the stored one: the update
    // branch must ignore it, because it never touches projected_*.
    const { data, error } = await settle(
      ruleId,
      '2026-06-19',
      toMinorUnits(2_400),
      toMinorUnits(1),
      '2026-06-20',
    )
    expect(error).toBeNull()
    expect(data?.id).toBe(before.id)
    expect(data?.status).toBe('confirmed')
    expect(data?.actual_amount_cents).toBe(toMinorUnits(2_400))
    expect(data?.actual_date).toBe('2026-06-20')
    expect(data?.is_overridden).toBe(false)

    const after = await occurrenceAt(context, ruleId, '2026-06-19')
    expect(after).toEqual({
      ...before,
      status: 'confirmed',
      actual_amount_cents: toMinorUnits(2_400),
      actual_date: '2026-06-20',
    })
  })

  it('settles a date that was never materialized by inserting it, keyed by the natural key', async () => {
    const { ruleId } = await seedRule(paycheck())
    expect(await occurrenceAt(context, ruleId, '2026-07-03')).toBeNull()

    const { data, error } = await settle(
      ruleId,
      '2026-07-03',
      toMinorUnits(2_300),
      toMinorUnits(2_000),
      '2026-07-02',
    )
    expect(error).toBeNull()
    expect(data?.projected_date).toBe('2026-07-03')
    expect(data?.projected_amount_cents).toBe(toMinorUnits(2_000))
    expect(data?.actual_amount_cents).toBe(toMinorUnits(2_300))
    expect(data?.actual_date).toBe('2026-07-02')
    expect(data?.status).toBe('confirmed')
    expect(data?.is_overridden).toBe(false)

    const reloaded = await occurrenceAt(context, ruleId, '2026-07-03')
    expect(reloaded?.id).toBe(data?.id)
  })

  it('feeds recent_settled_amounts(), and two settled paychecks move the estimate to their mean', async () => {
    const { ruleId } = await seedRule(paycheck(), true)
    // Nothing settled: the stored amount is the fallback.
    expect(await projectedEstimate(context, ruleId)).toBe(toMinorUnits(2_000))

    const first = await settle(
      ruleId,
      '2026-06-05',
      toMinorUnits(2_400),
      toMinorUnits(2_000),
      '2026-06-05',
    )
    expect(first.error).toBeNull()
    // One is not history yet (`domain/prediction.ts`): still the fallback.
    expect(await projectedEstimate(context, ruleId)).toBe(toMinorUnits(2_000))

    const second = await settle(
      ruleId,
      '2026-06-19',
      toMinorUnits(2_500),
      toMinorUnits(2_000),
      '2026-06-19',
    )
    expect(second.error).toBeNull()

    const rows = (await recentSettled(context)).filter((row) => row.rule_id === ruleId)
    expect(rows.map((row) => row.projected_date)).toEqual(['2026-06-05', '2026-06-19'])
    expect(await projectedEstimate(context, ruleId)).toBe(toMinorUnits(2_450))
  })

  it('refuses an amount whose sign contradicts the item, and a missing date, with PT400 — and writes nothing', async () => {
    const income = await seedRule(paycheck())
    const bill = await seedRule(rent())

    const refusals: readonly {
      readonly ruleId: string
      readonly projectedAmount: MinorUnits
      readonly amount: MinorUnits
      readonly actualDate: IsoDate | null
    }[] = [
      {
        ruleId: income.ruleId,
        projectedAmount: toMinorUnits(2_000),
        amount: toMinorUnits(0),
        actualDate: '2026-08-20',
      },
      {
        ruleId: income.ruleId,
        projectedAmount: toMinorUnits(2_000),
        amount: -toMinorUnits(2_000),
        actualDate: '2026-08-20',
      },
      {
        ruleId: bill.ruleId,
        projectedAmount: -toMinorUnits(900),
        amount: toMinorUnits(0),
        actualDate: '2026-08-20',
      },
      {
        ruleId: bill.ruleId,
        projectedAmount: -toMinorUnits(900),
        amount: toMinorUnits(900),
        actualDate: '2026-08-20',
      },
      // Right sign, no date.
      {
        ruleId: bill.ruleId,
        projectedAmount: -toMinorUnits(900),
        amount: -toMinorUnits(900),
        actualDate: null,
      },
    ]
    for (const refusal of refusals) {
      const { data, error } = await settle(
        refusal.ruleId,
        '2026-08-20',
        refusal.amount,
        refusal.projectedAmount,
        refusal.actualDate as IsoDate,
      )
      expect(error?.code).toBe('PT400')
      expect(data).toBeNull()
    }
    expect(await occurrenceAt(context, income.ruleId, '2026-08-20')).toBeNull()
    expect(await occurrenceAt(context, bill.ruleId, '2026-08-20')).toBeNull()
    expect((await recentSettled(context)).some((row) => row.rule_id === bill.ruleId)).toBe(false)
  })

  it('refuses an unknown rule id with PT404', async () => {
    const { data, error } = await settle(
      '00000000-0000-4000-8000-000000000000',
      '2026-08-20',
      -toMinorUnits(900),
      -toMinorUnits(900),
      '2026-08-20',
    )
    expect(error?.code).toBe('PT404')
    expect(data).toBeNull()
  })

  it('refuses a second settle of the same occurrence with PT409, keeping the first record', async () => {
    const { ruleId } = await seedRule(rent(), true)
    const first = await settle(ruleId, '2026-08-20', -91_000, -toMinorUnits(900), '2026-08-19')
    expect(first.error).toBeNull()

    const second = await settle(ruleId, '2026-08-20', -99_000, -toMinorUnits(900), '2026-08-21')
    expect(second.error?.code).toBe('PT409')

    const row = await occurrenceAt(context, ruleId, '2026-08-20')
    expect(row?.actual_amount_cents).toBe(-91_000)
    expect(row?.actual_date).toBe('2026-08-19')
    expect(row?.status).toBe('confirmed')
  })

  it('override_occurrence and revert_occurrence refuse a settled row with PT409', async () => {
    const { ruleId } = await seedRule(rent(), true)
    const settled = await settle(ruleId, '2026-08-20', -91_000, -toMinorUnits(900), '2026-08-20')
    expect(settled.error).toBeNull()

    const override = await context.client.rpc('override_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -50_000,
      p_actual_date: null as unknown as string,
    })
    expect(override.error?.code).toBe('PT409')

    const revert = await context.client.rpc('revert_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
    })
    expect(revert.error?.code).toBe('PT409')

    const row = await occurrenceAt(context, ruleId, '2026-08-20')
    expect(row?.status).toBe('confirmed')
    expect(row?.actual_amount_cents).toBe(-91_000)
    expect(row?.is_overridden).toBe(false)
  })

  it('a confirmed row survives a regenerate_occurrences run that no longer desires it; an unprotected sibling does not', async () => {
    const seeded = await seedRule(rent(), true)
    const { ruleId, item } = seeded
    const window = materializationWindow(TODAY)
    const settled = await settle(ruleId, '2026-08-20', -91_000, -toMinorUnits(900), '2026-08-20')
    expect(settled.error).toBeNull()
    // The sibling is there before, so its disappearance below is the run's doing.
    expect(await occurrenceAt(context, ruleId, '2026-09-20')).not.toBeNull()

    // Moving the anchor a day means no desired date matches the stored ones.
    const result = await regenerate(context, [ruleId], window, [
      { ...item, nextOccurrence: '2026-08-21' },
    ])
    expect(result.deleted).toBeGreaterThan(0)
    expect(await occurrenceAt(context, ruleId, '2026-09-20')).toBeNull()

    const survivor = await occurrenceAt(context, ruleId, '2026-08-20')
    expect(survivor?.status).toBe('confirmed')
    expect(survivor?.actual_amount_cents).toBe(-91_000)
    expect(survivor?.projected_amount_cents).toBe(-toMinorUnits(900))
  })

  it('unsettling a row that was never hand-edited clears the actuals and takes it out of the history', async () => {
    const { ruleId } = await seedRule(paycheck(), true)
    await settle(ruleId, '2026-06-05', toMinorUnits(2_400), toMinorUnits(2_000), '2026-06-05')
    await settle(ruleId, '2026-06-19', toMinorUnits(2_500), toMinorUnits(2_000), '2026-06-19')
    expect(await projectedEstimate(context, ruleId)).toBe(toMinorUnits(2_450))

    const { data, error } = await unsettle(ruleId, '2026-06-19')
    expect(error).toBeNull()
    expect(data?.status).toBe('projected')
    expect(data?.actual_amount_cents).toBeNull()
    expect(data?.actual_date).toBeNull()
    expect(data?.is_overridden).toBe(false)
    expect(data?.projected_amount_cents).toBe(toMinorUnits(2_000))

    const rows = (await recentSettled(context)).filter((row) => row.rule_id === ruleId)
    expect(rows.map((row) => row.projected_date)).toEqual(['2026-06-05'])
    // One settled amount left: back to the fallback.
    expect(await projectedEstimate(context, ruleId)).toBe(toMinorUnits(2_000))

    // And it can be settled again — the round trip leaves a normal projected row.
    const again = await settle(
      ruleId,
      '2026-06-19',
      toMinorUnits(2_600),
      toMinorUnits(2_000),
      '2026-06-19',
    )
    expect(again.error).toBeNull()
  })

  it('unsettling a row that was hand-edited first keeps it edited, carrying the settled figures', async () => {
    const { ruleId } = await seedRule(rent(), true)
    const override = await context.client.rpc('override_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -85_000,
      p_actual_date: null as unknown as string,
    })
    expect(override.error).toBeNull()

    const settled = await settle(ruleId, '2026-08-20', -86_000, -toMinorUnits(900), '2026-08-22')
    expect(settled.error).toBeNull()
    // Settling leaves is_overridden as it found it.
    expect(settled.data?.is_overridden).toBe(true)

    const { data, error } = await unsettle(ruleId, '2026-08-20')
    expect(error).toBeNull()
    expect(data?.status).toBe('projected')
    expect(data?.is_overridden).toBe(true)
    expect(data?.actual_amount_cents).toBe(-86_000)
    expect(data?.actual_date).toBe('2026-08-22')
  })

  it('unsettle refuses a row that is not settled with PT409, and a missing one with PT404', async () => {
    const { ruleId } = await seedRule(rent(), true)
    const before = await occurrenceAt(context, ruleId, '2026-08-20')
    expect(before?.status).toBe('projected')

    const notSettled = await unsettle(ruleId, '2026-08-20')
    expect(notSettled.error?.code).toBe('PT409')
    expect(await occurrenceAt(context, ruleId, '2026-08-20')).toEqual(before)

    const missing = await unsettle(ruleId, '2099-01-01')
    expect(missing.error?.code).toBe('PT404')
    expect(missing.data).toBeNull()
  })
})
