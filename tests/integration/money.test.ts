/**
 * Acceptance criterion: "Money values round-trip as integer cents."
 *
 * `CLAUDE.md` states the rule — money is integer minor units everywhere, and
 * major units exist only at the display edge. `domain/money.ts` is unit-tested
 * against it. What no unit test can reach is the part where the number leaves
 * the process: a column typed `numeric`, a driver that parses through a double,
 * or a PostgREST version that hands integers back as strings would each break
 * the rule somewhere no pure test is looking, and each would surface as
 * somebody's balance being wrong by a cent.
 *
 * So this file writes cents through the Data API under a real session, reads
 * them back the same way, and demands exact equality — plus a look at the
 * catalog, because a `numeric` column holding whole values today passes an
 * equality test and is still a bug waiting.
 */

import { describe, expect, it } from 'vitest'
import { assertMoneyRoundTripsAsIntegerCents } from '../support/assertions'
import { validUserContext } from '../support/auth'
import { adminSql, LOCAL_STACK } from '../support/database'
import { fixtureName, removeFixtures } from '../support/fixtures'

const LABEL = 'money'

/**
 * Values chosen for where they break things, not for looking like money.
 *
 * `MAX_SAFE_INTEGER` is the real ceiling: `bigint` reaches far past it, but
 * PostgREST returns JSON numbers and JSON numbers are IEEE doubles, so anything
 * above 2^53 - 1 comes back rounded. That is a genuine limit of the transport
 * rather than a bug in the schema, and testing right at the edge is what keeps
 * it a known limit instead of a surprise. See the human-TODO list in the PR.
 */
const EDGE_CASE_CENTS = [
  0,
  1,
  -1,
  99,
  100,
  -99,
  // An overdrawn account is a real reading — `accounts.balance_cents` is signed
  // on purpose (docs/database/schema.md).
  -123_456_789,
  123_456_789,
  Number.MAX_SAFE_INTEGER,
  -Number.MAX_SAFE_INTEGER,
] as const

/** Every column in the schema that holds money. */
const MONEY_COLUMNS = [
  ['accounts', 'balance_cents'],
  ['recurring_rules', 'amount_cents'],
  ['occurrences', 'projected_amount_cents'],
  ['occurrences', 'actual_amount_cents'],
  ['transfers', 'amount_cents'],
  ['user_settings', 'cushion_cents'],
  ['user_settings', 'monthly_discretionary_cents'],
] as const

describe.skipIf(LOCAL_STACK === null)('money in the database', () => {
  it('round-trips every edge-case value as exactly the integer cents it went in as', async () => {
    const context = await validUserContext()
    await expect(
      assertMoneyRoundTripsAsIntegerCents(context, LABEL, EDGE_CASE_CENTS),
    ).resolves.toBeUndefined()
  })

  it('stores every money column as bigint, never numeric or double', async () => {
    const sql = adminSql()
    try {
      const rows = await sql<{ table_name: string; column_name: string; data_type: string }[]>`
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
          and (column_name like '%_cents')
        order by table_name, column_name
      `

      const found = rows.map((row) => [row.table_name, row.column_name] as const)
      // Every money column the schema is supposed to have is present...
      for (const [table, column] of MONEY_COLUMNS) {
        expect(found).toContainEqual([table, column])
      }
      // ...and every column named like money is actually an integer type. This
      // direction is the one that catches a *new* column added as `numeric`.
      const wrongType = rows.filter((row) => row.data_type !== 'bigint')
      expect(
        wrongType.map((row) => `${row.table_name}.${row.column_name}: ${row.data_type}`),
      ).toEqual([])
    } finally {
      await sql.end()
    }
  })

  it('refuses a fractional amount outright rather than rounding it', async () => {
    const context = await validUserContext()
    try {
      // biome-ignore lint/suspicious/noExplicitAny: deliberately writing a value the column type forbids.
      const { data, error } = await (context.client.from('accounts') as any)
        .insert({
          user_id: context.userId,
          name: fixtureName(LABEL, 'fractional'),
          color: 'chart-2',
          balance_cents: 10.5,
          balance_as_of: '2026-08-15',
        })
        .select('id,balance_cents')

      // A silent round to 10 or 11 would be the worst outcome — the write
      // appears to succeed and the money is quietly wrong.
      expect(error).not.toBeNull()
      expect(data ?? []).toEqual([])
    } finally {
      await removeFixtures(LABEL)
    }
  })

  it('leaves nothing behind', async () => {
    const sql = adminSql()
    try {
      const [row] = await sql<{ count: string }[]>`
        select count(*)::text as count from public.accounts where name like ${`fixture:${LABEL}:%`}
      `
      expect(row?.count).toBe('0')
    } finally {
      await sql.end()
    }
  })
})
