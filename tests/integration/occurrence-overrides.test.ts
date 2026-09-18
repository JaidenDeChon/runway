/**
 * AC-A1 and the `override_occurrence` / `revert_occurrence` RPC contract
 * (issue #15, `supabase/migrations/20260913090000_occurrence_overrides_and_rule_split.sql`).
 *
 * Drives the RPCs directly, the way `app/composables/useRunwayData.ts`'s
 * `overrideOccurrence` / `revertOccurrence` eventually will — no application
 * code needed, matching `occurrence-regeneration.test.ts`'s own shape. Runs
 * under `secondUserContext()` (user B) for the same reason that file does: A
 * and C are `tests/rls/seed-fidelity.test.ts`'s exact-list fixtures.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { desiredOccurrences, materializationWindow } from '~~/domain/materialization'
import { toMinorUnits } from '~~/domain/money'
import type { RecurringItem } from '~~/domain/types'
import { type AuthContext, secondUserContext } from '../support/auth'
import { LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'occurrence-overrides'
const TODAY = '2026-09-03'

interface OccurrenceRow {
  readonly id: string
  readonly projected_date: string
  readonly projected_amount_cents: number
  readonly actual_amount_cents: number | null
  readonly actual_date: string | null
  readonly status: string
  readonly is_overridden: boolean
}

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

const baseItem = (id: string, over: Partial<RecurringItem> = {}): RecurringItem => ({
  id,
  name: 'fixture rule',
  kind: 'bill',
  amount: toMinorUnits(900),
  cadence: 'monthly',
  accountId: 'unused',
  nextOccurrence: '2026-08-20',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
  ...over,
})

describe.skipIf(LOCAL_STACK === null)('override_occurrence / revert_occurrence', () => {
  let context: AuthContext
  let caseIndex = 0

  /** One fresh account + monthly rent rule, isolated per test. */
  async function seedRentRule(): Promise<{ accountId: string; ruleId: string }> {
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
      recurringItems: [
        {
          id: 'rent',
          name: `Rent ${caseIndex}`,
          kind: 'bill',
          amount: toMinorUnits(900),
          cadence: 'monthly',
          accountId: 'a',
          nextOccurrence: '2026-08-20',
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

  it('AC-A1: an override on a materialized row survives regenerate_occurrences and reload', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId })])

    const before = await occurrenceAt(context, ruleId, '2026-08-20')
    if (!before) throw new Error('materialized row missing before override')
    expect(before.is_overridden).toBe(false)

    const { data: overridden, error: overrideError } = await context.client.rpc(
      'override_occurrence',
      {
        p_rule_id: ruleId,
        p_projected_date: '2026-08-20',
        p_projected_amount_cents: before.projected_amount_cents,
        p_actual_amount_cents: -44_960,
        p_actual_date: null as unknown as string,
      },
    )
    expect(overrideError).toBeNull()
    expect(overridden?.is_overridden).toBe(true)
    expect(overridden?.actual_amount_cents).toBe(-44_960)
    expect(overridden?.actual_date).toBeNull()
    // "on projected_date" — reload reads it back exactly this way.
    const reloaded = await occurrenceAt(context, ruleId, '2026-08-20')
    expect(reloaded?.actual_amount_cents).toBe(-44_960)
    expect(reloaded?.is_overridden).toBe(true)

    // A following regeneration over the same window neither upserts nor
    // deletes this row, and the actual amount is untouched — the row is
    // protected by is_overridden, per the regeneration contract.
    const result = await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId })])
    expect(result).toEqual({ upserted: 0, deleted: 0 })
    const afterRegen = await occurrenceAt(context, ruleId, '2026-08-20')
    expect(afterRegen?.actual_amount_cents).toBe(-44_960)
    expect(afterRegen?.projected_amount_cents).toBe(before.projected_amount_cents)
  })

  it('override on a date with no materialized row inserts one, is_overridden = true, keyed by the natural key', async () => {
    const { accountId, ruleId } = await seedRentRule()
    // No regenerate_occurrences call — this date is not materialized yet.
    const futureDate = '2026-11-20'
    const projectedAmount = -toMinorUnits(900)

    const { data: inserted, error: overrideError } = await context.client.rpc(
      'override_occurrence',
      {
        p_rule_id: ruleId,
        p_projected_date: futureDate,
        p_projected_amount_cents: projectedAmount,
        p_actual_amount_cents: -85_000,
        p_actual_date: null as unknown as string,
      },
    )
    expect(overrideError).toBeNull()
    expect(inserted?.projected_date).toBe(futureDate)
    expect(inserted?.projected_amount_cents).toBe(projectedAmount)
    expect(inserted?.actual_amount_cents).toBe(-85_000)
    expect(inserted?.is_overridden).toBe(true)
    expect(inserted?.status).toBe('projected')

    void accountId
  })

  it('a second override of the same row succeeds — the protection trigger does not block a re-edit', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId })])

    const first = await context.client.rpc('override_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -80_000,
      p_actual_date: null as unknown as string,
    })
    expect(first.error).toBeNull()

    const second = await context.client.rpc('override_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -81_000,
      p_actual_date: '2026-08-21',
    })
    expect(second.error).toBeNull()
    expect(second.data?.actual_amount_cents).toBe(-81_000)
    expect(second.data?.actual_date).toBe('2026-08-21')
  })

  it('override on a settled (confirmed) occurrence is rejected with PT409', async () => {
    const { ruleId, accountId } = await seedRentRule()
    const { error: insertError } = await context.client.from('occurrences').insert({
      user_id: context.userId as string,
      account_id: accountId,
      rule_id: ruleId,
      projected_date: '2026-08-20',
      projected_amount_cents: -toMinorUnits(900),
      status: 'confirmed',
      actual_amount_cents: -toMinorUnits(900),
    })
    expect(insertError).toBeNull()

    const { error } = await context.client.rpc('override_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -50_000,
      p_actual_date: null as unknown as string,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT409')
  })

  it('override against an unknown rule id is rejected with PT404', async () => {
    const { error } = await context.client.rpc('override_occurrence', {
      p_rule_id: '00000000-0000-4000-8000-000000000000',
      p_projected_date: '2026-08-20',
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -50_000,
      p_actual_date: null as unknown as string,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT404')
  })

  it('revert clears actual_* / is_overridden, and a following regeneration brings projected_amount_cents back in line', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId })])

    await context.client.rpc('override_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -85_000,
      p_actual_date: null as unknown as string,
    })

    const { data: reverted, error: revertError } = await context.client.rpc('revert_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
    })
    expect(revertError).toBeNull()
    expect(reverted?.actual_amount_cents).toBeNull()
    expect(reverted?.actual_date).toBeNull()
    expect(reverted?.is_overridden).toBe(false)

    // The rule's amount changed while the row was protected; now that it is
    // unprotected again, regeneration brings the stored projected amount back
    // in line with the rule's current amount.
    const changed = toMinorUnits(950)
    const result = await regenerate(context, [ruleId], window, [
      baseItem(ruleId, { accountId, amount: changed }),
    ])
    expect(result.upserted).toBeGreaterThan(0)
    const after = await occurrenceAt(context, ruleId, '2026-08-20')
    expect(after?.projected_amount_cents).toBe(-changed)
  })

  it('revert of a confirmed occurrence raises PT409 — the check constraint would reject the null write anyway', async () => {
    const { ruleId, accountId } = await seedRentRule()
    const { error: insertError } = await context.client.from('occurrences').insert({
      user_id: context.userId as string,
      account_id: accountId,
      rule_id: ruleId,
      projected_date: '2026-08-20',
      projected_amount_cents: -toMinorUnits(900),
      status: 'confirmed',
      actual_amount_cents: -toMinorUnits(900),
    })
    expect(insertError).toBeNull()

    const { error } = await context.client.rpc('revert_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2026-08-20',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT409')
  })

  it('revert against an unknown occurrence is rejected with PT404', async () => {
    const { ruleId } = await seedRentRule()
    const { error } = await context.client.rpc('revert_occurrence', {
      p_rule_id: ruleId,
      p_projected_date: '2099-01-01',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT404')
  })
})
