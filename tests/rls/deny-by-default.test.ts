/**
 * Acceptance criterion: "RLS enabled on every table by default; a new table
 * without a policy denies all access."
 *
 * These assertions run against the catalog rather than through PostgREST on
 * purpose. Asking the Data API about a table it has never seen returns 404
 * whether the table is locked down or merely absent from a stale schema cache
 * — a test that accepts 404 as proof would pass for the wrong reason.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { adminSql, LOCAL_STACK } from './helpers'

/** Deliberately unqualified by any policy or grant — that is the point. */
const PROBE_TABLE = 'rls_probe_unpoliced'

describe.skipIf(LOCAL_STACK === null)('deny-by-default posture', () => {
  afterAll(async () => {
    if (!LOCAL_STACK) return
    const sql = adminSql()
    try {
      await sql.unsafe(`drop table if exists public.${PROBE_TABLE}`)
    } finally {
      await sql.end()
    }
  })

  it('has row level security enabled on every table in public', async () => {
    const sql = adminSql()
    try {
      const rows = await sql<{ tablename: string }[]>`
        select c.relname as tablename
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and not c.relrowsecurity
      `
      expect(rows.map((r) => r.tablename)).toEqual([])
    } finally {
      await sql.end()
    }
  })

  it('grants anon and authenticated nothing by default on future tables', async () => {
    const sql = adminSql()
    try {
      const rows = await sql<{ defaclrole: string; defaclacl: string | null }[]>`
        select pg_get_userbyid(defaclrole) as defaclrole, defaclacl::text as defaclacl
        from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname = 'public'
      `
      const forPostgres = rows.filter((r) => r.defaclrole === 'postgres')
      expect(forPostgres.length).toBeGreaterThan(0)

      const acl = forPostgres.map((r) => r.defaclacl ?? '').join(' ')
      expect(acl).not.toMatch(/\banon=/)
      expect(acl).not.toMatch(/\bauthenticated=/)
    } finally {
      await sql.end()
    }
  })

  it('locks down a brand-new table that declares no policy and no grant', async () => {
    const sql = adminSql()
    try {
      await sql.unsafe(`drop table if exists public.${PROBE_TABLE}`)
      await sql.unsafe(`
        create table public.${PROBE_TABLE} (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null,
          secret text not null
        )
      `)

      // The event trigger should have turned RLS on without being asked.
      const [flags] = await sql<{ enabled: boolean; forced: boolean }[]>`
        select relrowsecurity as enabled, relforcerowsecurity as forced
        from pg_class
        where oid = ${`public.${PROBE_TABLE}`}::regclass
      `
      expect(flags?.enabled).toBe(true)
      expect(flags?.forced).toBe(true)

      // And no API role can touch it.
      const [privs] = await sql<
        {
          anon_select: boolean
          auth_select: boolean
          auth_insert: boolean
        }[]
      >`
        select
          has_table_privilege('anon', ${`public.${PROBE_TABLE}`}, 'SELECT') as anon_select,
          has_table_privilege('authenticated', ${`public.${PROBE_TABLE}`}, 'SELECT') as auth_select,
          has_table_privilege('authenticated', ${`public.${PROBE_TABLE}`}, 'INSERT') as auth_insert
      `
      expect(privs?.anon_select).toBe(false)
      expect(privs?.auth_select).toBe(false)
      expect(privs?.auth_insert).toBe(false)

      // Belt and braces: even with a grant, zero policies means zero rows.
      const [policies] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from pg_policies
        where schemaname = 'public' and tablename = ${PROBE_TABLE}
      `
      expect(policies?.count).toBe('0')
    } finally {
      await sql.end()
    }
  })

  it('keeps the private schema out of reach of the API roles', async () => {
    const sql = adminSql()
    try {
      const [row] = await sql<{ anon_usage: boolean; auth_usage: boolean }[]>`
        select
          has_schema_privilege('anon', 'private', 'USAGE') as anon_usage,
          has_schema_privilege('authenticated', 'private', 'USAGE') as auth_usage
      `
      expect(row?.anon_usage).toBe(false)
      expect(row?.auth_usage).toBe(false)
    } finally {
      await sql.end()
    }
  })
})
