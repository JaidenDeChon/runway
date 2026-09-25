/**
 * AC-A3 — `override_occurrence`, `revert_occurrence` and `split_recurring_rule`
 * (issue #15), and `settle_occurrence` / `unsettle_occurrence` (issue #26's
 * manual half, `supabase/migrations/20260925010000_settle_occurrence.sql`),
 * cannot touch another user's rule or occurrence, no matter what id a caller
 * names, and each returns an *error* rather than a silent no-op. The two
 * settlement functions are also closed to `anon` outright: an unauthenticated
 * caller is refused at the privilege layer before the function body runs.
 *
 * Modelled on `tests/rls/occurrence-regeneration.test.ts`: probe rows are
 * seeded through `secondUserContext()` (user B)'s own session — never the
 * admin connection, so seeding itself exercises the INSERT policies — and
 * every assertion names ids, codes and counts, never a message.
 *
 * The mechanism under test (docs/database/schema.md, "The regeneration
 * contract" and plan §4.5): `security invoker` means RLS evaluates as the
 * caller, so user A's `select ... from recurring_rules where id = p_rule_id`
 * finds nothing for one of B's rules — not because a policy silently filtered
 * a write to zero rows, but because the row was never visible to select from
 * in the first place. Each function's own `if not found then raise sqlstate
 * 'PT404'` is what turns that into an error the client sees, rather than a
 * `data: null, error: null` an application could easily miss.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toMinorUnits } from '~~/domain/money'
import { type AuthContext, secondUserContext, validUserContext } from '../support/auth'
import { adminSql, anonClient, LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'occurrence-editing-isolation'
const TODAY = '2026-09-03'

interface OccurrenceProbe {
  readonly id: string
  readonly status: string
  readonly is_overridden: boolean
  /** `bigint`, which postgres.js hands back as a string. */
  readonly actual_amount_cents: string | null
  readonly actual_date: string | null
  readonly updated_at: string
}

async function readOccurrence(ruleId: string, date: string): Promise<OccurrenceProbe> {
  const sql = adminSql()
  try {
    const rows = await sql<OccurrenceProbe[]>`
      select id, status, is_overridden, actual_amount_cents, actual_date::text, updated_at::text
        from public.occurrences
       where rule_id = ${ruleId} and projected_date = ${date}
    `
    const row = rows[0]
    if (!row) throw new Error('probe occurrence not found')
    return row
  } finally {
    await sql.end()
  }
}

async function readRule(ruleId: string): Promise<{
  readonly name: string
  readonly ends_on: string | null
}> {
  const sql = adminSql()
  try {
    const rows = await sql<{ name: string; ends_on: string | null }[]>`
      select name, ends_on::text from public.recurring_rules where id = ${ruleId}
    `
    const row = rows[0]
    if (!row) throw new Error('probe rule not found')
    return row
  } finally {
    await sql.end()
  }
}

async function countRulesNamed(name: string): Promise<number> {
  const sql = adminSql()
  try {
    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from public.recurring_rules where name = ${name}
    `
    return Number(rows[0]?.count ?? '0')
  } finally {
    await sql.end()
  }
}

describe.skipIf(LOCAL_STACK === null)('occurrence-editing RPCs cross-user isolation', () => {
  let contextB: AuthContext
  let contextA: AuthContext
  let bRuleId: string
  let bProjectedDate: string
  let bProbeBefore: OccurrenceProbe
  let bRuleBefore: { name: string; ends_on: string | null }
  /** A second probe, settled by B itself, so `unsettle_occurrence` has something it could act on. */
  let bSettledDate: string
  let bSettledBefore: OccurrenceProbe

  beforeAll(async () => {
    await removeFixtures(LABEL)
    contextB = await secondUserContext()
    contextA = await validUserContext()

    bProjectedDate = '2026-08-20'
    const household = await seedHousehold(contextB, {
      label: LABEL,
      accounts: [
        {
          id: 'a',
          name: 'B account',
          balance: toMinorUnits(1_000),
          balanceAsOf: TODAY,
          color: 'chart-2',
          isDiscretionarySource: false,
        },
      ],
      recurringItems: [
        {
          id: 'rule',
          name: 'B rule',
          kind: 'bill',
          amount: toMinorUnits(900),
          cadence: 'monthly',
          accountId: 'a',
          nextOccurrence: bProjectedDate,
          amountSource: 'fixed',
          depositHistory: [],
          isVariable: false,
        },
      ],
      materializeOccurrences: { start: '2026-06-01', end: '2026-12-31' },
    })
    bRuleId = household.ruleIds.get('rule') as string

    // Settled through B's own session, like every other probe row. Without a
    // settled row, A's unsettle would be refused with PT404 for the dull
    // reason that nothing was settled to begin with.
    bSettledDate = '2026-09-20'
    const { error: settleError } = await contextB.client.rpc('settle_occurrence', {
      p_rule_id: bRuleId,
      p_projected_date: bSettledDate,
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -toMinorUnits(910),
      p_actual_date: bSettledDate,
    })
    if (settleError) throw new Error(`could not settle B's probe: ${settleError.code}`)

    bProbeBefore = await readOccurrence(bRuleId, bProjectedDate)
    bSettledBefore = await readOccurrence(bRuleId, bSettledDate)
    bRuleBefore = await readRule(bRuleId)
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeFixtures(LABEL)
  })

  it("guard: B's probe rule and occurrence exist, so the assertions below are not vacuous", async () => {
    expect(bRuleId).toBeTruthy()
    expect(bProbeBefore.is_overridden).toBe(false)
    expect(bProbeBefore.status).toBe('projected')
    expect(bSettledBefore.status).toBe('confirmed')
    expect(bSettledBefore.actual_amount_cents).toBe(String(-toMinorUnits(910)))
    expect(bRuleBefore.name).toBe('fixture:occurrence-editing-isolation:B rule')
  })

  it("A calling override_occurrence with B's rule id is rejected with PT404, and B's row is unchanged", async () => {
    const { data, error } = await contextA.client.rpc('override_occurrence', {
      p_rule_id: bRuleId,
      p_projected_date: bProjectedDate,
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -1,
      p_actual_date: null as unknown as string,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT404')
    expect(data).toBeNull()

    const after = await readOccurrence(bRuleId, bProjectedDate)
    expect(after.is_overridden).toBe(false)
    expect(after.actual_amount_cents).toBeNull()
    expect(after.actual_date).toBeNull()
    expect(after.updated_at).toBe(bProbeBefore.updated_at)
  })

  it("A calling revert_occurrence with B's rule id is rejected with PT404, and B's row is unchanged", async () => {
    const { data, error } = await contextA.client.rpc('revert_occurrence', {
      p_rule_id: bRuleId,
      p_projected_date: bProjectedDate,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT404')
    expect(data).toBeNull()

    const after = await readOccurrence(bRuleId, bProjectedDate)
    expect(after.updated_at).toBe(bProbeBefore.updated_at)
  })

  it("A calling split_recurring_rule with B's rule id is rejected with PT404, and B keeps exactly one rule, ends_on unchanged", async () => {
    const { data, error } = await contextA.client.rpc('split_recurring_rule', {
      p_rule_id: bRuleId,
      p_effective_from: bProjectedDate,
      p_amount_cents: toMinorUnits(1),
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT404')
    expect(data).toBeNull()

    const ruleName = 'fixture:occurrence-editing-isolation:B rule'
    expect(await countRulesNamed(ruleName)).toBe(1)
    const ruleAfter = await readRule(bRuleId)
    expect(ruleAfter.ends_on).toBe(bRuleBefore.ends_on)
  })

  it("A calling settle_occurrence with B's rule id is rejected with PT404, and B's row is unchanged", async () => {
    const { data, error } = await contextA.client.rpc('settle_occurrence', {
      p_rule_id: bRuleId,
      p_projected_date: bProjectedDate,
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -1,
      p_actual_date: bProjectedDate,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('PT404')
    expect(data).toBeNull()

    expect(await readOccurrence(bRuleId, bProjectedDate)).toEqual(bProbeBefore)
  })

  it("A calling settle_occurrence on a date B never materialized inserts nothing under B's rule", async () => {
    // The insert branch is the one that writes a row that did not exist, so
    // it gets its own probe: PT404 before any insert, and no row afterwards.
    const unmaterialized = '2027-06-20'
    const { error } = await contextA.client.rpc('settle_occurrence', {
      p_rule_id: bRuleId,
      p_projected_date: unmaterialized,
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -1,
      p_actual_date: '2026-09-01',
    })
    expect(error?.code).toBe('PT404')

    const sql = adminSql()
    try {
      const rows = await sql<{ count: string }[]>`
        select count(*)::text as count from public.occurrences
         where rule_id = ${bRuleId} and projected_date = ${unmaterialized}
      `
      expect(Number(rows[0]?.count ?? '0')).toBe(0)
    } finally {
      await sql.end()
    }
  })

  it("A calling unsettle_occurrence on B's settled occurrence is rejected with PT404, and B's row stays settled", async () => {
    const { data, error } = await contextA.client.rpc('unsettle_occurrence', {
      p_rule_id: bRuleId,
      p_projected_date: bSettledDate,
    })
    expect(error).not.toBeNull()
    // PT404, not PT409: the row is settled, so a 409 would mean A could see it.
    expect(error?.code).toBe('PT404')
    expect(data).toBeNull()

    expect(await readOccurrence(bRuleId, bSettledDate)).toEqual(bSettledBefore)
  })

  it('an unauthenticated caller cannot execute settle_occurrence or unsettle_occurrence', async () => {
    const anon = anonClient()
    const settle = await anon.rpc('settle_occurrence', {
      p_rule_id: bRuleId,
      p_projected_date: bProjectedDate,
      p_projected_amount_cents: -toMinorUnits(900),
      p_actual_amount_cents: -1,
      p_actual_date: bProjectedDate,
    })
    const unsettle = await anon.rpc('unsettle_occurrence', {
      p_rule_id: bRuleId,
      p_projected_date: bSettledDate,
    })
    // 42501 is insufficient_privilege: `revoke all ... from public` leaves
    // `anon` without EXECUTE, so the body — and its `not authenticated`
    // guard — never runs.
    expect(settle.error?.code).toBe('42501')
    expect(unsettle.error?.code).toBe('42501')
    expect(settle.data).toBeNull()
    expect(unsettle.data).toBeNull()

    expect(await readOccurrence(bRuleId, bProjectedDate)).toEqual(bProbeBefore)
    expect(await readOccurrence(bRuleId, bSettledDate)).toEqual(bSettledBefore)

    // And at the catalog level, so the refusal above cannot be some other
    // failure that happens to share the code.
    const sql = adminSql()
    try {
      const [row] = await sql<
        { anon_settle: boolean; anon_unsettle: boolean; auth_settle: boolean }[]
      >`
        select
          has_function_privilege('anon', 'public.settle_occurrence(uuid, date, bigint, bigint, date)', 'EXECUTE') as anon_settle,
          has_function_privilege('anon', 'public.unsettle_occurrence(uuid, date)', 'EXECUTE') as anon_unsettle,
          has_function_privilege('authenticated', 'public.settle_occurrence(uuid, date, bigint, bigint, date)', 'EXECUTE') as auth_settle
      `
      expect(row).toEqual({ anon_settle: false, anon_unsettle: false, auth_settle: true })
    } finally {
      await sql.end()
    }
  })

  it('A calling all five with its own rule and a materialized occurrence succeeds — proving isolation, not a broken function', async () => {
    const ownDate = '2026-08-05'
    const household = await seedHousehold(contextA, {
      label: LABEL,
      accounts: [
        {
          id: 'own',
          name: 'A own account',
          balance: toMinorUnits(500),
          balanceAsOf: TODAY,
          color: 'chart-4',
          isDiscretionarySource: false,
        },
      ],
      recurringItems: [
        {
          id: 'own-rule',
          name: 'A own rule',
          kind: 'bill',
          amount: toMinorUnits(500),
          cadence: 'monthly',
          accountId: 'own',
          nextOccurrence: ownDate,
          amountSource: 'fixed',
          depositHistory: [],
          isVariable: false,
        },
      ],
      materializeOccurrences: { start: '2026-06-01', end: '2026-12-31' },
    })
    const ownRuleId = household.ruleIds.get('own-rule') as string

    const overrideResult = await contextA.client.rpc('override_occurrence', {
      p_rule_id: ownRuleId,
      p_projected_date: ownDate,
      p_projected_amount_cents: -toMinorUnits(500),
      p_actual_amount_cents: -toMinorUnits(450),
      p_actual_date: null as unknown as string,
    })
    expect(overrideResult.error).toBeNull()
    expect(overrideResult.data?.is_overridden).toBe(true)

    const revertResult = await contextA.client.rpc('revert_occurrence', {
      p_rule_id: ownRuleId,
      p_projected_date: ownDate,
    })
    expect(revertResult.error).toBeNull()
    expect(revertResult.data?.is_overridden).toBe(false)

    const settleResult = await contextA.client.rpc('settle_occurrence', {
      p_rule_id: ownRuleId,
      p_projected_date: ownDate,
      p_projected_amount_cents: -toMinorUnits(500),
      p_actual_amount_cents: -toMinorUnits(480),
      p_actual_date: ownDate,
    })
    expect(settleResult.error).toBeNull()
    expect(settleResult.data?.status).toBe('confirmed')

    const unsettleResult = await contextA.client.rpc('unsettle_occurrence', {
      p_rule_id: ownRuleId,
      p_projected_date: ownDate,
    })
    expect(unsettleResult.error).toBeNull()
    expect(unsettleResult.data?.status).toBe('projected')

    const splitResult = await contextA.client.rpc('split_recurring_rule', {
      p_rule_id: ownRuleId,
      p_effective_from: '2026-09-05',
      p_amount_cents: toMinorUnits(550),
    })
    expect(splitResult.error).toBeNull()
    expect(splitResult.data?.[0]?.closed_rule_id).toBe(ownRuleId)
    expect(splitResult.data?.[0]?.successor_rule_id).not.toBeNull()
  })
})
