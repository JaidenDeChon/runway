/**
 * Acceptance criteria AC1-AC6 for `public.regenerate_occurrences`
 * (issue #9, `supabase/migrations/20260904015555_occurrence_regeneration.sql`).
 *
 * Drives the RPC directly, the way `app/composables/useRunwayData.ts`'s
 * `regenerateOccurrences` eventually will — this file needs no application
 * code, so it is independently verifiable ahead of Phase 3. The desired set
 * is computed the same way the app computes it, through
 * `domain/materialization.ts`'s `desiredOccurrences`, never re-implemented
 * here as hand-written rows — the whole point of Decision 2.5 is that there
 * is exactly one cadence expander.
 *
 * Runs under **user B's own session** (`secondUserContext()`), for the same
 * reason `recurring-rules-crud.test.ts` does: A and C are
 * `tests/rls/seed-fidelity.test.ts`'s exact-list fixtures.
 *
 * Every test seeds its own account + rule rather than sharing one across the
 * file, so each acceptance criterion is provable on its own and one test's
 * regeneration history cannot leak into the next one's assertions.
 *
 * `projected_amount_cents` and the RPC's `upserted`/`deleted` counts come
 * back through `supabase-js`/PostgREST as JS numbers (the generated types
 * agree), so no bigint-as-string normalization is needed on this file's own
 * reads.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DesiredOccurrence, MaterializationWindow } from '~~/domain/materialization'
import { desiredOccurrences, materializationWindow } from '~~/domain/materialization'
import { toMinorUnits } from '~~/domain/money'
import type { RecurringItem } from '~~/domain/types'
import { type AuthContext, secondUserContext } from '../support/auth'
import { LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'occurrence-regeneration'
const TODAY = '2026-09-03'

interface RegenerationResult {
  readonly upserted: number
  readonly deleted: number
}

/** Mirrors app/lib/supabase/occurrences.ts's toRegenerationArgs, which does not exist until Phase 3. */
function toArgs(
  ruleIds: readonly string[],
  window: MaterializationWindow,
  desired: readonly DesiredOccurrence[],
) {
  return {
    p_rule_ids: [...ruleIds],
    p_window_start: window.start,
    p_window_end: window.end,
    p_occurrence_rule_ids: desired.map((d) => d.ruleId),
    p_occurrence_dates: desired.map((d) => d.date),
    p_occurrence_amount_cents: desired.map((d) => d.amount),
  }
}

async function regenerate(
  context: AuthContext,
  ruleIds: readonly string[],
  window: MaterializationWindow,
  items: readonly RecurringItem[],
): Promise<RegenerationResult> {
  const desired = desiredOccurrences(items, window)
  const { data, error } = await context.client.rpc(
    'regenerate_occurrences',
    toArgs(ruleIds, window, desired),
  )
  if (error) throw new Error(`regenerate_occurrences failed: ${error.message}`)
  return data?.[0] ?? { upserted: 0, deleted: 0 }
}

interface OccurrenceRow {
  readonly projected_date: string
  readonly projected_amount_cents: number
  readonly status: string
  readonly is_overridden: boolean
  readonly updated_at: string
}

async function occurrencesFor(context: AuthContext, ruleId: string): Promise<OccurrenceRow[]> {
  const { data, error } = await context.client
    .from('occurrences')
    .select('projected_date, projected_amount_cents, status, is_overridden, updated_at')
    .eq('rule_id', ruleId)
    .order('projected_date', { ascending: true })
  if (error) throw new Error(`could not read occurrences: ${error.message}`)
  return data ?? []
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

describe.skipIf(LOCAL_STACK === null)('regenerate_occurrences', () => {
  let context: AuthContext
  let userId: string
  let caseIndex = 0

  /** One fresh account + monthly rent rule, anchored the 20th, isolated per test. */
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
      // No materializeOccurrences: this file materializes through the RPC
      // itself, which is the thing under test.
    })
    return {
      accountId: household.accountIds.get('a') as string,
      ruleId: household.ruleIds.get('rent') as string,
    }
  }

  beforeAll(async () => {
    await removeFixtures(LABEL)
    context = await secondUserContext()
    if (!context.userId) throw new Error('second-user context has no user id')
    userId = context.userId
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeFixtures(LABEL)
  })

  it('AC1: running it twice changes nothing — no row inserted, updated or deleted, no updated_at moved', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    const item = baseItem(ruleId, { accountId })

    const first = await regenerate(context, [ruleId], window, [item])
    expect(first.upserted).toBeGreaterThan(0)

    const before = await occurrencesFor(context, ruleId)
    expect(before.length).toBeGreaterThan(0)

    const second = await regenerate(context, [ruleId], window, [item])
    expect(second).toEqual({ upserted: 0, deleted: 0 })

    const after = await occurrencesFor(context, ruleId)
    expect(after).toEqual(before)
  })

  it('AC2: an overridden occurrence survives ten regeneration cycles with a changing rule amount', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId })])

    const { error: overrideError } = await context.client
      .from('occurrences')
      .update({ is_overridden: true, actual_amount_cents: -85_000 })
      .eq('rule_id', ruleId)
      .eq('projected_date', '2026-08-20')
    expect(overrideError).toBeNull()

    const overridden = (await occurrencesFor(context, ruleId)).find(
      (row) => row.projected_date === '2026-08-20',
    )
    if (!overridden) throw new Error('override did not stick')
    const frozen = { ...overridden }

    for (let cycle = 0; cycle < 10; cycle++) {
      // Varying the amount between iterations is what makes this non-vacuous
      // — a static amount would pass even if the WHERE guard were missing,
      // because there would be nothing to (wrongly) write.
      const cents = toMinorUnits(900 + cycle * 10)
      await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId, amount: cents })])

      const current = (await occurrencesFor(context, ruleId)).find(
        (row) => row.projected_date === '2026-08-20',
      )
      if (!current) throw new Error(`overridden row vanished on cycle ${cycle}`)
      expect(current.projected_amount_cents, `cycle ${cycle}`).toBe(frozen.projected_amount_cents)
      expect(current.status, `cycle ${cycle}`).toBe(frozen.status)
      expect(current.is_overridden, `cycle ${cycle}`).toBe(frozen.is_overridden)
      expect(current.updated_at, `cycle ${cycle}`).toBe(frozen.updated_at)
    }
  })

  it('AC3: a changed amount lands only on unprotected rows in the window', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId })])

    const { error: overrideError } = await context.client
      .from('occurrences')
      .update({ is_overridden: true, actual_amount_cents: -70_000 })
      .eq('rule_id', ruleId)
      .eq('projected_date', '2026-09-20')
    expect(overrideError).toBeNull()

    const changed = toMinorUnits(950)
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId, amount: changed })])

    const rows = await occurrencesFor(context, ruleId)
    const protectedRow = rows.find((row) => row.projected_date === '2026-09-20')
    const unprotectedRow = rows.find((row) => row.projected_date === '2026-10-20')
    if (!protectedRow || !unprotectedRow) throw new Error('expected rows missing')

    expect(protectedRow.projected_amount_cents).toBe(toMinorUnits(-900))
    expect(unprotectedRow.projected_amount_cents).toBe(-changed)
  })

  it('AC3: setting ends_on removes unprotected future rows and keeps protected ones', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId })])

    // Override a row that will fall outside the shrunk rule's window, so it
    // is exactly the case the guarded delete must not touch.
    const { error: overrideError } = await context.client
      .from('occurrences')
      .update({ is_overridden: true, actual_amount_cents: -60_000 })
      .eq('rule_id', ruleId)
      .eq('projected_date', '2026-12-20')
    expect(overrideError).toBeNull()

    const shrunk = baseItem(ruleId, { accountId, endsOn: '2026-10-31' })
    await regenerate(context, [ruleId], window, [shrunk])

    const rows = await occurrencesFor(context, ruleId)
    const dates = new Set(rows.map((row) => row.projected_date))

    // Unprotected, now past ends_on: gone.
    expect(dates.has('2026-11-20')).toBe(false)
    // Protected, even though it is also past ends_on: retained as history.
    expect(dates.has('2026-12-20')).toBe(true)
    const kept = rows.find((row) => row.projected_date === '2026-12-20')
    expect(kept?.is_overridden).toBe(true)
    expect(kept?.projected_amount_cents).toBe(toMinorUnits(-900))
  })

  it('AC4: a rule split materializes contiguous, non-duplicated occurrences across the boundary', async () => {
    caseIndex += 1
    const window = materializationWindow(TODAY)

    const closed = await seedHousehold(context, {
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
          id: 'old',
          name: `Rent split old ${caseIndex}`,
          kind: 'bill',
          amount: toMinorUnits(1_650),
          cadence: 'monthly',
          accountId: 'a',
          nextOccurrence: '2026-08-01',
          amountSource: 'fixed',
          depositHistory: [],
          isVariable: false,
          endsOn: '2026-08-31',
        },
        {
          id: 'new',
          name: `Rent split new ${caseIndex}`,
          kind: 'bill',
          amount: toMinorUnits(1_750),
          cadence: 'monthly',
          accountId: 'a',
          nextOccurrence: '2026-09-01',
          amountSource: 'fixed',
          depositHistory: [],
          isVariable: false,
          startsOn: '2026-09-01',
        },
      ],
    })

    const splitAccountId = closed.accountIds.get('a') as string
    const oldRuleId = closed.ruleIds.get('old') as string
    const newRuleId = closed.ruleIds.get('new') as string

    const oldItem = baseItem(oldRuleId, {
      accountId: splitAccountId,
      amount: toMinorUnits(1_650),
      nextOccurrence: '2026-08-01',
      endsOn: '2026-08-31',
    })
    const newItem = baseItem(newRuleId, {
      accountId: splitAccountId,
      amount: toMinorUnits(1_750),
      nextOccurrence: '2026-09-01',
      startsOn: '2026-09-01',
    })

    // Two independent regenerations, one per rule — never a bulk occurrence
    // edit (docs/database/schema.md, "Rule splitting").
    await regenerate(context, [oldRuleId], window, [oldItem])
    await regenerate(context, [newRuleId], window, [newItem])

    const oldDates = (await occurrencesFor(context, oldRuleId)).map((row) => row.projected_date)
    const newDates = (await occurrencesFor(context, newRuleId)).map((row) => row.projected_date)
    const combined = [...oldDates, ...newDates]

    expect(combined).toEqual([...new Set(combined)]) // no duplicate date
    expect(oldDates).toContain('2026-08-01')
    expect(newDates).toContain('2026-09-01')
    expect(oldDates.every((date) => date <= '2026-08-31')).toBe(true)
    expect(newDates.every((date) => date >= '2026-09-01')).toBe(true)
  })

  it('AC5: advancing the simulated clock extends the horizon without duplicating or losing rows', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const windowT = materializationWindow(TODAY)
    await regenerate(context, [ruleId], windowT, [baseItem(ruleId, { accountId })])

    const before = await occurrencesFor(context, ruleId)
    const beforeDates = new Set(before.map((row) => row.projected_date))

    const laterToday = '2026-10-13' // TODAY + 40 days
    const windowLater = materializationWindow(laterToday)
    await regenerate(context, [ruleId], windowLater, [baseItem(ruleId, { accountId })])

    const after = await occurrencesFor(context, ruleId)
    const afterByDate = new Map(after.map((row) => [row.projected_date, row]))

    // Every previously-present date is still present exactly once, unmoved.
    for (const row of before) {
      const stillThere = afterByDate.get(row.projected_date)
      expect(stillThere, `expected ${row.projected_date} to survive`).toBeDefined()
      expect(stillThere?.updated_at).toBe(row.updated_at)
    }

    // New dates appeared — the horizon actually extended forward.
    const newDates = after.filter((row) => !beforeDates.has(row.projected_date))
    expect(newDates.length).toBeGreaterThan(0)

    // No duplicates: one row per date, before or after.
    const afterDates = after.map((row) => row.projected_date)
    expect(afterDates).toEqual([...new Set(afterDates)])
  })

  it('AC6: a row older than the look-back is never touched', async () => {
    const { accountId, ruleId } = await seedRentRule()
    const window = materializationWindow(TODAY)
    const oldDate = '2025-08-01' // well before TODAY - 90 days

    const { error: insertError } = await context.client.from('occurrences').insert({
      user_id: userId,
      account_id: accountId,
      rule_id: ruleId,
      projected_date: oldDate,
      projected_amount_cents: -12_345,
    })
    expect(insertError).toBeNull()

    const beforeRegen = await occurrencesFor(context, ruleId)
    const historic = beforeRegen.find((row) => row.projected_date === oldDate)
    if (!historic) throw new Error('planted historic row did not persist')

    await regenerate(context, [ruleId], window, [baseItem(ruleId, { accountId })])

    const afterRegen = await occurrencesFor(context, ruleId)
    const stillHistoric = afterRegen.find((row) => row.projected_date === oldDate)
    expect(stillHistoric).toEqual(historic)
  })
})
