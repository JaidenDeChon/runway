/**
 * Issue #18 — income prediction from history, against the live local stack.
 *
 * The Definition of Done asks for integration tests that "confirm predictions
 * use only the user's own history". `public.recent_settled_amounts()` is
 * `security invoker` with no user parameter, so RLS on `occurrences` is the
 * only thing scoping it; this file proves that from both sides — user B's
 * estimate is built from B's rows alone while user A holds more, and larger,
 * settled rows of their own — and then runs B's rows through the app's own
 * mapping (`withSettledHistory`) and the engine (`resolveAmount`), so the
 * figure asserted is the one the dashboard would project.
 *
 * It also pins the function's other contract — settled means
 * `status = 'confirmed'`, the window is the caller's own
 * `user_settings.prediction_window`, and the most recent N win — and the
 * redefined `split_recurring_rule`, which now pins the amount it is given.
 *
 * Every row goes in through the owning user's own session (CLAUDE.md,
 * "Seed fixtures go in through a user's own session"), which also exercises
 * the INSERT policy for a settled occurrence. B carries the bulk of the work,
 * matching `occurrence-overrides.test.ts`; A only ever holds rows labelled
 * with this file's fixture prefix, removed afterwards, so
 * `tests/rls/seed-fidelity.test.ts`'s exact lists are untouched (the
 * integration project runs files sequentially — vitest.config.ts).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withSettledHistory } from '~~/app/lib/supabase/occurrences'
import { RECURRING_RULE_COLUMNS, toRecurringItem } from '~~/app/lib/supabase/recurring-items'
import { toMinorUnits } from '~~/domain/money'
import { resolveAmount } from '~~/domain/prediction'
import type { RecurringItem } from '~~/domain/types'
import { type AuthContext, secondUserContext, validUserContext } from '../support/auth'
import { adminSql, LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'income-prediction'
const TODAY = '2026-09-03'

interface Seeded {
  readonly accountId: string
  readonly ruleId: string
}

const rule = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'pay',
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

let caseIndex = 0

async function seedRule(context: AuthContext, over: Partial<RecurringItem> = {}): Promise<Seeded> {
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
    recurringItems: [rule({ name: `Paycheck ${caseIndex}`, ...over })],
  })
  return {
    accountId: household.accountIds.get('a') as string,
    ruleId: household.ruleIds.get('pay') as string,
  }
}

/** Inserts occurrences through the owner's own session — the INSERT policy is part of what is under test. */
async function settle(
  context: AuthContext,
  seeded: Seeded,
  rows: readonly {
    readonly date: string
    readonly actual: number
    readonly status?: 'confirmed' | 'skipped' | 'projected'
  }[],
): Promise<void> {
  const { error } = await context.client.from('occurrences').insert(
    rows.map((row) => ({
      user_id: context.userId as string,
      account_id: seeded.accountId,
      rule_id: seeded.ruleId,
      projected_date: row.date,
      projected_amount_cents: row.actual,
      actual_amount_cents: row.actual,
      status: row.status ?? 'confirmed',
    })),
  )
  if (error) throw new Error(`could not settle occurrences: ${error.message}`)
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

describe.skipIf(LOCAL_STACK === null)('income prediction from settled history (#18)', () => {
  let userB: AuthContext
  let userA: AuthContext
  let originalWindowB = 3

  beforeAll(async () => {
    await removeFixtures(LABEL)
    userB = await secondUserContext()
    userA = await validUserContext()
    const { data } = await userB.client
      .from('user_settings')
      .select('prediction_window')
      .eq('user_id', userB.userId as string)
      .single()
    originalWindowB = data?.prediction_window ?? 3
    const { error } = await setWindow(userB, 3)
    if (error) throw new Error(`could not reset the window: ${error.message}`)
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await setWindow(userB, originalWindowB)
    await removeFixtures(LABEL)
  })

  it('defaults prediction_window to 3, and bounds it to 2..12', async () => {
    // Catalog state, so the superuser connection is the right tool — this
    // asserts the column's default, never an isolation property.
    const sql = adminSql()
    try {
      const [column] = await sql<{ column_default: string | null; is_nullable: string }[]>`
        select column_default, is_nullable
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'user_settings'
           and column_name = 'prediction_window'`
      expect(column).toEqual({ column_default: '3', is_nullable: 'NO' })
    } finally {
      await sql.end()
    }

    for (const outOfRange of [1, 13]) {
      const { error } = await setWindow(userB, outOfRange)
      // 23514 is check_violation: the constraint, not a permissions failure.
      expect(error?.code).toBe('23514')
    }
  })

  it('predicts from the caller’s own settled history only, while another user holds more of their own', async () => {
    const mine = await seedRule(userB)
    await settle(userB, mine, [
      { date: '2026-07-03', actual: toMinorUnits(2_400) },
      { date: '2026-07-17', actual: toMinorUnits(2_500) },
    ])

    // User A: more settled rows, far larger, on a rule of their own. If RLS
    // leaked a single one of them into B's read, B's estimate would move.
    const theirs = await seedRule(userA)
    await settle(userA, theirs, [
      { date: '2026-07-03', actual: toMinorUnits(90_000) },
      { date: '2026-07-17', actual: toMinorUnits(90_000) },
      { date: '2026-07-31', actual: toMinorUnits(90_000) },
    ])

    const seenByB = await recentSettled(userB)
    expect(seenByB.some((row) => row.rule_id === theirs.ruleId)).toBe(false)
    expect(seenByB.filter((row) => row.rule_id === mine.ruleId)).toHaveLength(2)

    const seenByA = await recentSettled(userA)
    expect(seenByA.some((row) => row.rule_id === mine.ruleId)).toBe(false)

    expect(await projectedEstimate(userB, mine.ruleId)).toBe(toMinorUnits(2_450))
    expect(await projectedEstimate(userA, theirs.ruleId)).toBe(toMinorUnits(90_000))
  })

  it('cannot settle an occurrence onto another user’s rule', async () => {
    const theirs = await seedRule(userA)
    const { error } = await userB.client.from('occurrences').insert({
      user_id: userB.userId as string,
      account_id: theirs.accountId,
      rule_id: theirs.ruleId,
      projected_date: '2026-07-03',
      projected_amount_cents: toMinorUnits(1),
      actual_amount_cents: toMinorUnits(1),
      status: 'confirmed',
    })
    // The composite FK to (user_id, rule_id, account_id) has no parent for B,
    // so this is refused whichever check fires first — and nothing lands.
    expect(error).not.toBeNull()
    const seenByA = await recentSettled(userA)
    expect(seenByA.filter((row) => row.rule_id === theirs.ruleId)).toHaveLength(0)
  })

  it('counts only confirmed rows, and takes the most recent `prediction_window` of them, oldest first', async () => {
    const seeded = await seedRule(userB)
    await settle(userB, seeded, [
      { date: '2026-06-05', actual: toMinorUnits(1_000) },
      { date: '2026-06-19', actual: toMinorUnits(2_000) },
      { date: '2026-07-03', actual: toMinorUnits(3_000) },
      { date: '2026-07-17', actual: toMinorUnits(4_000) },
      // Not settled: a cancelled cycle and a hand-edited but unsettled one.
      { date: '2026-07-31', actual: toMinorUnits(50_000), status: 'skipped' },
    ])
    const { error: projectedError } = await userB.client.from('occurrences').insert({
      user_id: userB.userId as string,
      account_id: seeded.accountId,
      rule_id: seeded.ruleId,
      projected_date: '2026-08-14',
      projected_amount_cents: toMinorUnits(2_000),
      actual_amount_cents: toMinorUnits(60_000),
      status: 'projected',
      is_overridden: true,
    })
    if (projectedError) throw new Error(`could not seed an override: ${projectedError.message}`)

    const rows = (await recentSettled(userB)).filter((row) => row.rule_id === seeded.ruleId)
    expect(rows.map((row) => row.projected_date)).toEqual([
      '2026-06-19',
      '2026-07-03',
      '2026-07-17',
    ])
    expect(await projectedEstimate(userB, seeded.ruleId)).toBe(toMinorUnits(3_000))

    const { error } = await setWindow(userB, 2)
    if (error) throw new Error(`could not set the window: ${error.message}`)
    try {
      const narrowed = (await recentSettled(userB)).filter((row) => row.rule_id === seeded.ruleId)
      expect(narrowed.map((row) => row.projected_date)).toEqual(['2026-07-03', '2026-07-17'])
      expect(await projectedEstimate(userB, seeded.ruleId)).toBe(toMinorUnits(3_500))
    } finally {
      await setWindow(userB, 3)
    }
  })

  it('falls back to the stored amount with one settled occurrence, and with none', async () => {
    const none = await seedRule(userB)
    expect(await projectedEstimate(userB, none.ruleId)).toBe(toMinorUnits(2_000))

    const one = await seedRule(userB)
    await settle(userB, one, [{ date: '2026-07-03', actual: toMinorUnits(2_600) }])
    expect(await projectedEstimate(userB, one.ruleId)).toBe(toMinorUnits(2_000))
  })

  it('estimates a variable bill from its settled payments the same way', async () => {
    const bill = await seedRule(userB, {
      kind: 'bill',
      amount: toMinorUnits(120),
      amountSource: 'fixed',
      isVariable: true,
      cadence: 'monthly',
    })
    // Bills settle as negative amounts, like every other occurrence amount.
    await settle(userB, bill, [
      { date: '2026-07-05', actual: toMinorUnits(-130) },
      { date: '2026-08-05', actual: toMinorUnits(-150) },
    ])
    expect(await projectedEstimate(userB, bill.ruleId)).toBe(toMinorUnits(140))
  })

  it('apply-to-future pins the amount: an in-place split stops estimating, even with history', async () => {
    const seeded = await seedRule(userB, { nextOccurrence: '2026-06-05' })
    await settle(userB, seeded, [
      { date: '2026-06-05', actual: toMinorUnits(2_400) },
      { date: '2026-06-19', actual: toMinorUnits(2_500) },
    ])
    expect(await projectedEstimate(userB, seeded.ruleId)).toBe(toMinorUnits(2_450))

    // On the rule's own first occurrence: the in-place branch, same rule id,
    // same settled history. Before #18 the estimate would have painted over
    // the 2,100 the user just typed.
    const { error } = await userB.client.rpc('split_recurring_rule', {
      p_rule_id: seeded.ruleId,
      p_effective_from: '2026-06-05',
      p_amount_cents: toMinorUnits(2_100),
    })
    if (error) throw new Error(`split_recurring_rule failed: ${error.message}`)

    const { data } = await userB.client
      .from('recurring_rules')
      .select('amount_source, is_variable, amount_cents')
      .eq('id', seeded.ruleId)
      .single()
    expect(data).toEqual({ amount_source: 'fixed', is_variable: false, amount_cents: 210_000 })
    expect(await projectedEstimate(userB, seeded.ruleId)).toBe(toMinorUnits(2_100))
  })

  it('apply-to-future pins the successor of a variable bill too', async () => {
    const bill = await seedRule(userB, {
      kind: 'bill',
      amount: toMinorUnits(120),
      amountSource: 'fixed',
      isVariable: true,
      cadence: 'monthly',
      nextOccurrence: '2026-06-05',
    })
    const { data, error } = await userB.client.rpc('split_recurring_rule', {
      p_rule_id: bill.ruleId,
      p_effective_from: '2026-09-05',
      p_amount_cents: toMinorUnits(160),
    })
    if (error) throw new Error(`split_recurring_rule failed: ${error.message}`)
    const successorId = data?.[0]?.successor_rule_id as string

    const { data: successor } = await userB.client
      .from('recurring_rules')
      .select('amount_source, is_variable, amount_cents')
      .eq('id', successorId)
      .single()
    expect(successor).toEqual({ amount_source: 'fixed', is_variable: false, amount_cents: 16_000 })

    // The closed predecessor keeps what it was: history is not rewritten.
    const { data: closed } = await userB.client
      .from('recurring_rules')
      .select('is_variable, ends_on')
      .eq('id', bill.ruleId)
      .single()
    expect(closed).toEqual({ is_variable: true, ends_on: '2026-09-04' })
  })
})
