/**
 * AC7 — `public.regenerate_occurrences` cannot create, update or delete an
 * occurrence belonging to another user, and cannot operate across users in
 * one call, no matter what `p_rule_ids` names.
 *
 * The function derives `v_user_id` from `(select auth.uid())` and never from
 * a parameter (`supabase/migrations/20260904015555_occurrence_regeneration.sql`).
 * That makes the whole function single-user by construction — there is no
 * code path where a call touches two users' rows in one transaction — but
 * this file proves the sharpest version of the claim anyway: a caller who
 * *names* another user's rule id gets exactly nothing, because the insert's
 * join requires `r.user_id = v_user_id` and the delete's predicate requires
 * `o.user_id = v_user_id`, both independent of what `p_rule_ids` says.
 *
 * Same two rules as `domain-tables.test.ts`: probe rows are created and torn
 * down over `adminSql()`, never through a policy-governed client, and every
 * assertion names ids/counts/rows — never an error string.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSql, LOCAL_STACK, signedInClient, USER_A, USER_B } from './helpers'

const PROBE_PREFIX = 'probe:occurrence-regeneration:'

interface ProbeRow {
  readonly id: string
  readonly projected_date: string
  readonly projected_amount_cents: number
  readonly is_overridden: boolean
  readonly status: string
  readonly updated_at: string
}

let bAccountId: string
let bRuleId: string
let bProtectedRow: ProbeRow
let bUnprotectedRow: ProbeRow

async function removeProbes(): Promise<void> {
  const sql = adminSql()
  try {
    await sql`delete from public.accounts where name like ${`${PROBE_PREFIX}%`}`
  } finally {
    await sql.end()
  }
}

async function readBRows(): Promise<ProbeRow[]> {
  const sql = adminSql()
  try {
    return await sql<ProbeRow[]>`
      select id, projected_date::text, projected_amount_cents::int as projected_amount_cents,
             is_overridden, status::text, updated_at::text
        from public.occurrences
       where rule_id = ${bRuleId}
       order by projected_date
    `
  } finally {
    await sql.end()
  }
}

describe.skipIf(LOCAL_STACK === null)('regenerate_occurrences cross-user isolation', () => {
  beforeAll(async () => {
    await removeProbes()
    const sql = adminSql()
    try {
      const [account] = await sql<{ id: string }[]>`
        insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
        values (${USER_B.id}, ${`${PROBE_PREFIX}account`}, 'chart-2', 10_000, '2026-08-15')
        returning id
      `
      if (!account) throw new Error('could not create the probe account')
      bAccountId = account.id

      const [rule] = await sql<{ id: string }[]>`
        insert into public.recurring_rules
          (user_id, account_id, name, kind, amount_cents, cadence, anchor_date)
        values
          (${USER_B.id}, ${bAccountId}, ${`${PROBE_PREFIX}rule`}, 'bill', 900, 'monthly', '2026-08-20')
        returning id
      `
      if (!rule) throw new Error('could not create the probe rule')
      bRuleId = rule.id

      await sql`
        insert into public.occurrences (user_id, account_id, rule_id, projected_date, projected_amount_cents, is_overridden, status, actual_amount_cents)
        values (${USER_B.id}, ${bAccountId}, ${bRuleId}, '2026-08-20', -900, true, 'projected', -850)
      `
      await sql`
        insert into public.occurrences (user_id, account_id, rule_id, projected_date, projected_amount_cents)
        values (${USER_B.id}, ${bAccountId}, ${bRuleId}, '2026-09-20', -900)
      `
    } finally {
      await sql.end()
    }

    const rows = await readBRows()
    const protectedRow = rows.find((row) => row.is_overridden)
    const unprotectedRow = rows.find((row) => !row.is_overridden)
    if (!protectedRow || !unprotectedRow) throw new Error('probe setup did not create both rows')
    bProtectedRow = protectedRow
    bUnprotectedRow = unprotectedRow
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeProbes()
  })

  it("guard: B's probe rows exist so the assertions below are not vacuous", () => {
    expect(bProtectedRow.projected_amount_cents).toBe(-900)
    expect(bUnprotectedRow.projected_amount_cents).toBe(-900)
  })

  it("A calling with B's rule id writes nothing and deletes nothing from B", async () => {
    const clientA = await signedInClient(USER_A)

    // A tries to: rewrite the amount on B's unprotected row, rewrite the
    // (structurally immutable) amount on B's protected row, add a brand-new
    // date, and — by omitting 2026-09-20 from the desired set entirely —
    // delete B's unprotected row outright. Every one of those is exactly what
    // the guarded upsert/delete allow a legitimate owner to do; the only
    // thing under test is that none of it reaches a row A does not own.
    const { data, error } = await clientA.rpc('regenerate_occurrences', {
      p_rule_ids: [bRuleId],
      p_window_start: '2026-06-01',
      p_window_end: '2026-12-31',
      p_occurrence_rule_ids: [bRuleId, bRuleId],
      p_occurrence_dates: ['2026-08-20', '2026-10-20'],
      p_occurrence_amount_cents: [-1, -1],
    })

    expect(error).toBeNull()
    expect(data).toEqual([{ upserted: 0, deleted: 0 }])

    const after = await readBRows()
    // Same two rows, same ids, same values, same updated_at — nothing moved.
    // readBRows orders by projected_date; bProtectedRow (08-20) sorts before
    // bUnprotectedRow (09-20).
    expect(after).toEqual([bProtectedRow, bUnprotectedRow])

    // No stray row landed anywhere for this rule under any user — the insert's
    // join (`r.user_id = v_user_id`) means A's call could not create a row at
    // all, not even one it would itself own.
    const sql = adminSql()
    try {
      const [row] = await sql<{ count: string }[]>`
        select count(*)::text as count from public.occurrences where rule_id = ${bRuleId}
      `
      if (!row) throw new Error('count query returned no row')
      expect(row.count).toBe('2')
    } finally {
      await sql.end()
    }
  })

  it("mixing B's rule id into a call scoped to A's own rules touches only A's rule", async () => {
    const sql = adminSql()
    let aRuleId = ''
    try {
      const [account] = await sql<{ id: string }[]>`
        insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
        values (${USER_A.id}, ${`${PROBE_PREFIX}a-account`}, 'chart-3', 5_000, '2026-08-15')
        returning id
      `
      if (!account) throw new Error('could not create the A-owned probe account')
      const [rule] = await sql<{ id: string }[]>`
        insert into public.recurring_rules
          (user_id, account_id, name, kind, amount_cents, cadence, anchor_date)
        values
          (${USER_A.id}, ${account.id}, ${`${PROBE_PREFIX}a-rule`}, 'bill', 500, 'monthly', '2026-08-05')
        returning id
      `
      if (!rule) throw new Error('could not create the A-owned probe rule')
      aRuleId = rule.id
    } finally {
      await sql.end()
    }

    const clientA = await signedInClient(USER_A)
    const beforeB = await readBRows()

    const { data, error } = await clientA.rpc('regenerate_occurrences', {
      // One legitimate rule (A's own) mixed with one foreign rule (B's).
      p_rule_ids: [aRuleId, bRuleId],
      p_window_start: '2026-06-01',
      p_window_end: '2026-12-31',
      p_occurrence_rule_ids: [aRuleId, bRuleId],
      p_occurrence_dates: ['2026-08-05', '2026-08-20'],
      p_occurrence_amount_cents: [-500, -1],
    })
    expect(error).toBeNull()
    // Exactly one row upserted — A's own. B's contributes nothing, in either
    // direction, in the same call.
    expect(data).toEqual([{ upserted: 1, deleted: 0 }])

    const afterB = await readBRows()
    expect(afterB).toEqual(beforeB)

    const sqlCheck = adminSql()
    try {
      const rows = await sqlCheck<{ id: string }[]>`
        select id from public.occurrences where rule_id = ${aRuleId}
      `
      expect(rows).toHaveLength(1)
    } finally {
      await sqlCheck.end()
    }
  })
})
