/**
 * Acceptance criterion: "at least one integration test for migration-from-zero
 * success."
 *
 * ## What actually performs the from-zero application
 *
 * Not this file. `supabase start` applies every migration to an empty database
 * and then loads the seed, and the `database` job in `.github/workflows/ci.yml`
 * does that from nothing on every pull request; locally `bun run db:reset` is
 * the same act. A migration that cannot apply from zero fails there, loudly,
 * before a single test runs.
 *
 * ## What this file adds
 *
 * That the database the suite is about to make claims about is *exactly* what
 * those migrations produce, and nothing else. Without it, "the migrations
 * applied" and "the schema is right" are two different facts and CI only knows
 * the first. Three ways they come apart, all of which have happened to someone:
 *
 * - A migration file added to the repo and never applied, because the author
 *   ran the suite against a stack they started last week. Every schema
 *   assertion still passes; the new table simply is not tested.
 * - A change made by hand in Studio, or by a test that forgot to roll back,
 *   which exists in the running database and in no migration at all.
 * - A migration applied out of order, which works right up until a fresh
 *   database sees the real order.
 *
 * So the ledger is compared against the directory in both directions, and the
 * objects the migrations are supposed to create are checked to be present —
 * because a migration that applied and silently did nothing would satisfy the
 * ledger check on its own.
 */

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { adminSql, LOCAL_STACK } from '../support/database'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))

/** `20260819171405_core_domain_schema.sql` -> `20260819171405`. */
function versionOf(filename: string): string | null {
  const match = /^(\d{14})_.+\.sql$/.exec(filename)
  return match?.[1] ?? null
}

function migrationsOnDisk(): { readonly versions: string[]; readonly files: string[] } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const versions: string[] = []
  for (const file of files) {
    const version = versionOf(file)
    if (!version) {
      throw new Error(
        `migration "${file}" is not named <14-digit-timestamp>_<description>.sql — ` +
          'the CLI derives the applied version from that prefix, so a file it cannot parse ' +
          'is a file that will not apply on a fresh database',
      )
    }
    versions.push(version)
  }
  return { versions, files }
}

/**
 * Objects the migrations create. If a migration applied but did nothing, the
 * ledger below would still line up and only this would notice.
 */
const EXPECTED_TABLES = [
  'accounts',
  'dashboard_hidden_accounts',
  'occurrences',
  'recurring_rules',
  'rls_fixture_items',
  'transfers',
  'user_settings',
] as const

const EXPECTED_ENUMS = [
  'occurrence_status',
  'recurring_amount_source',
  'recurring_cadence',
  'recurring_kind',
] as const

describe('migrations', () => {
  it('are all named so the CLI can derive a version from them', () => {
    const { versions, files } = migrationsOnDisk()
    expect(versions).toHaveLength(files.length)
    expect(versions.length).toBeGreaterThan(0)
  })

  it('are in strictly ascending order on disk, with no duplicate versions', () => {
    const { versions } = migrationsOnDisk()
    const sorted = [...versions].sort()
    expect(versions).toEqual(sorted)
    expect(new Set(versions).size).toBe(versions.length)
  })
})

describe.skipIf(LOCAL_STACK === null)('the running database', () => {
  it('has applied every migration in the repository, and nothing else', async () => {
    const { versions } = migrationsOnDisk()
    const sql = adminSql()
    try {
      const applied = await sql<{ version: string }[]>`
        select version from supabase_migrations.schema_migrations order by version
      `
      const appliedVersions = applied.map((row) => row.version)

      const missing = versions.filter((version) => !appliedVersions.includes(version))
      const extra = appliedVersions.filter((version) => !versions.includes(version))

      // Asserted as arrays rather than with `.toContain` so a failure prints
      // exactly which versions are on which side.
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    } finally {
      await sql.end()
    }
  })

  it('applied them in the order the filenames give', async () => {
    const sql = adminSql()
    try {
      const applied = await sql<{ version: string }[]>`
        select version from supabase_migrations.schema_migrations order by version
      `
      const versions = applied.map((row) => row.version)
      expect(versions).toEqual([...versions].sort())
    } finally {
      await sql.end()
    }
  })

  it('holds every table the migrations create', async () => {
    const sql = adminSql()
    try {
      const rows = await sql<{ tablename: string }[]>`
        select c.relname as tablename
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname
      `
      expect(rows.map((row) => row.tablename)).toEqual([...EXPECTED_TABLES])
    } finally {
      await sql.end()
    }
  })

  it('holds every enum type the migrations create', async () => {
    const sql = adminSql()
    try {
      const rows = await sql<{ typname: string }[]>`
        select t.typname
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typtype = 'e'
        order by t.typname
      `
      expect(rows.map((row) => row.typname)).toEqual([...EXPECTED_ENUMS])
    } finally {
      await sql.end()
    }
  })

  /**
   * The seed is part of "a known state". A from-zero database with no seed
   * would satisfy every assertion above and then fail every isolation test for
   * a reason that has nothing to do with isolation.
   */
  it('loaded the seed users', async () => {
    const sql = adminSql()
    try {
      const rows = await sql<{ email: string }[]>`
        select email from auth.users where email like '%@runway.test' order by email
      `
      expect(rows.map((row) => row.email)).toEqual([
        'user-a@runway.test',
        'user-b@runway.test',
        'user-c@runway.test',
        'user-d@runway.test',
      ])
    } finally {
      await sql.end()
    }
  })
})
