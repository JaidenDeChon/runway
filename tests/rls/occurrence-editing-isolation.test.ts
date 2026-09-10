/**
 * AC-A3 — `override_occurrence`, `revert_occurrence` and `split_recurring_rule`
 * (issue #15) cannot touch another user's rule or occurrence, no matter what
 * id a caller names, and each returns an *error* rather than a silent no-op.
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
import { adminSql, LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'occurrence-editing-isolation'
const TODAY = '2026-09-03'

interface OccurrenceProbe {
  readonly id: string
  readonly is_overridden: boolean
  readonly actual_amount_cents: number | null
  readonly actual_date: string | null
  readonly updated_at: string
}

async function readOccurrence(ruleId: string, date: string): Promise<OccurrenceProbe> {
  const sql = adminSql()
  try {
    const rows = await sql<OccurrenceProbe[]>`
      select id, is_overridden, actual_amount_cents, actual_date, updated_at::text
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

    bProbeBefore = await readOccurrence(bRuleId, bProjectedDate)
    bRuleBefore = await readRule(bRuleId)
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeFixtures(LABEL)
  })

  it("guard: B's probe rule and occurrence exist, so the assertions below are not vacuous", async () => {
    expect(bRuleId).toBeTruthy()
    expect(bProbeBefore.is_overridden).toBe(false)
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

  it('A calling all three with its own rule and a materialized occurrence succeeds — proving isolation, not a broken function', async () => {
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
