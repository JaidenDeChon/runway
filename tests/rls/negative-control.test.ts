/**
 * Acceptance criterion: "loosening a policy causes the RLS tests to fail
 * (proves the harness works)."
 *
 * A suite that passes against a wide-open database is worse than no suite,
 * because it is mistaken for evidence. This file widens the fixture table's
 * SELECT policy on purpose, asserts that the isolation check *fails* while it
 * is wide, and then puts it back.
 *
 * It mutates shared database state, which is why the `rls` project in
 * vitest.config.ts sets `fileParallelism: false` and `sequence.concurrent:
 * false`. Do not turn either back on.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { adminSql, assertUserAOnlySeesOwnRows, FIXTURE_TABLE, LOCAL_STACK } from './helpers'

const LOOSE_POLICY = 'rls_fixture_items_negative_control'

async function loosenPolicy(): Promise<void> {
  const sql = adminSql()
  try {
    // Policies are OR'd together, so this one alone opens SELECT to every
    // authenticated user regardless of ownership.
    await sql.unsafe(`
      create policy ${LOOSE_POLICY}
        on public.${FIXTURE_TABLE}
        for select
        to authenticated
        using (true)
    `)
  } finally {
    await sql.end()
  }
}

async function restorePolicy(): Promise<void> {
  const sql = adminSql()
  try {
    await sql.unsafe(`drop policy if exists ${LOOSE_POLICY} on public.${FIXTURE_TABLE}`)
  } finally {
    await sql.end()
  }
}

describe.skipIf(LOCAL_STACK === null)('negative control', () => {
  // Runs even if an assertion above threw mid-test. Leaving the loose policy
  // behind would silently disarm every other file in this project.
  afterAll(async () => {
    if (!LOCAL_STACK) return
    await restorePolicy()
  })

  it('detects a loosened policy instead of passing through it', async () => {
    // 1. Baseline: the isolation check passes against the real policy.
    await expect(assertUserAOnlySeesOwnRows()).resolves.toBeGreaterThan(0)

    // 2. Widen the policy.
    await loosenPolicy()

    // 3. The very same check must now fail. If this resolves, the harness is
    //    blind and every other assertion in this project is worthless.
    await expect(assertUserAOnlySeesOwnRows()).rejects.toThrow(/RLS BREACH/)

    // 4. Put it back.
    await restorePolicy()

    // 5. And confirm the restore actually took.
    await expect(assertUserAOnlySeesOwnRows()).resolves.toBeGreaterThan(0)
  })

  it('leaves exactly the migration-defined policies behind', async () => {
    const sql = adminSql()
    try {
      const rows = await sql<{ policyname: string }[]>`
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = ${FIXTURE_TABLE}
        order by policyname
      `
      expect(rows.map((r) => r.policyname)).toEqual([
        'rls_fixture_items_delete_own',
        'rls_fixture_items_insert_own',
        'rls_fixture_items_select_own',
        'rls_fixture_items_update_own',
      ])
    } finally {
      await sql.end()
    }
  })
})
