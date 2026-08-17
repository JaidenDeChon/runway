/**
 * Acceptance criterion: "a test proving an unauthenticated client can read
 * nothing."
 *
 * The anon key is public — it ships in the browser bundle by design. What
 * stops it reading data is the privilege revocation in
 * `20260817020810_deny_by_default_privileges.sql`, backed by RLS. This file is
 * what proves that is true rather than assumed.
 */

import { describe, expect, it } from 'vitest'
import { adminSql, anonClient, FIXTURE_TABLE, LOCAL_STACK, USER_A } from './helpers'

describe.skipIf(LOCAL_STACK === null)('an unauthenticated client', () => {
  it('reads no rows from the fixture table', async () => {
    const client = anonClient()
    const { data, error } = await client.from(FIXTURE_TABLE).select('id, user_id')

    // Either shape is a pass: PostgREST may refuse outright (no privilege on
    // the table) or return an empty set (privilege present, RLS filtering).
    // What must never happen is a row coming back.
    if (!error) {
      expect(data ?? []).toEqual([])
    }
    expect(data ?? []).toHaveLength(0)
  })

  it('cannot count rows', async () => {
    const client = anonClient()
    const { count, error } = await client
      .from(FIXTURE_TABLE)
      .select('*', { count: 'exact', head: true })

    if (!error) {
      expect(count ?? 0).toBe(0)
    }
  })

  it('cannot insert a row', async () => {
    const client = anonClient()
    const { error } = await client
      .from(FIXTURE_TABLE)
      .insert({ user_id: USER_A.id, label: 'inserted by anon' })

    expect(error).not.toBeNull()
  })

  it('cannot delete rows', async () => {
    const client = anonClient()
    const { error } = await client.from(FIXTURE_TABLE).delete().neq('label', '')

    // A refusal is the expected outcome. If the delete is *allowed* but matches
    // nothing, `error` is null — so verify separately that the rows survive.
    if (error) {
      expect(error).not.toBeNull()
    } else {
      const sql = adminSql()
      try {
        const [row] = await sql<{ count: string }[]>`
          select count(*)::text as count from public.${sql(FIXTURE_TABLE)}
        `
        expect(Number(row?.count ?? 0)).toBeGreaterThan(0)
      } finally {
        await sql.end()
      }
    }
  })

  it('holds no privilege on the fixture table at the database level', async () => {
    const sql = adminSql()
    try {
      const [row] = await sql<{ can_select: boolean }[]>`
        select has_table_privilege('anon', ${`public.${FIXTURE_TABLE}`}, 'SELECT') as can_select
      `
      expect(row?.can_select).toBe(false)
    } finally {
      await sql.end()
    }
  })
})
