/**
 * The critical invariants, written once and reusable.
 *
 * Issue #5 asks for exactly three, by name: "cannot read another user's rows",
 * "unauthenticated reads nothing", and "money values round-trip as integer
 * cents". They live here rather than inline in a test file for the reason the
 * RLS suite already learned with `assertUserAOnlySeesOwnRows` — an invariant
 * that exists as a function can be handed to a negative control and proven to
 * *fail* when the thing it guards is broken. An invariant written inline can
 * only ever be observed passing.
 *
 * Each throws with a message that names what it found. None of them prints a
 * balance, a token or a connection string: the issue forbids those in CI logs,
 * and an assertion message is the easiest place to leak one by accident. Row
 * ids and counts are safe and are what a reader actually needs.
 */

import type { AuthContext } from './auth'
import { adminSql } from './database'
import { fixtureName, removeFixtures } from './fixtures'

/**
 * Proves `reader` sees no row belonging to anybody else in `table`.
 *
 * Returns how many rows the reader legitimately sees, so a caller can also
 * assert the read was not vacuous — "sees nothing at all" passes an isolation
 * check for the wrong reason, and is the failure mode of a broken seed.
 */
export async function assertCannotReadAnotherUsersRows(
  reader: AuthContext,
  table: string,
): Promise<number> {
  if (!reader.userId) {
    throw new Error(
      `assertCannotReadAnotherUsersRows needs a context with a user, got "${reader.name}"`,
    )
  }

  const result = await reader.restSelect(table, 'id,user_id')
  if (result.status !== 200) {
    throw new Error(
      `"${reader.name}" could not read its own rows from ${table}: ` +
        `HTTP ${result.status}${result.code ? ` (${result.code})` : ''}`,
    )
  }

  const foreign = result.rows.filter((row) => row.user_id !== reader.userId)
  if (foreign.length > 0) {
    throw new Error(
      `RLS BREACH: "${reader.name}" can see ${foreign.length} row(s) in ${table} owned by ` +
        `another user (ids: ${foreign.map((row) => String(row.id)).join(', ')})`,
    )
  }
  return result.rows.length
}

/**
 * Proves an unauthenticated caller reads nothing from `table`.
 *
 * Two shapes pass: PostgREST refusing outright (the role holds no privilege on
 * the table) or returning an empty set (privilege present, RLS filtering).
 * What must never happen is a row coming back — so both are accepted and the
 * row count is what is actually asserted.
 */
export async function assertUnauthenticatedReadsNothing(
  anonymous: AuthContext,
  table: string,
): Promise<void> {
  if (anonymous.userId !== null) {
    throw new Error(
      `assertUnauthenticatedReadsNothing needs a context with no user, got "${anonymous.name}"`,
    )
  }

  const result = await anonymous.restSelect(table, '*')
  if (result.rows.length > 0) {
    throw new Error(
      `RLS BREACH: an unauthenticated caller read ${result.rows.length} row(s) from ${table}`,
    )
  }
  if (result.status === 200 && result.rows.length !== 0) {
    throw new Error(`unauthenticated read of ${table} returned 200 with rows`)
  }
}

/**
 * Proves money survives the database as exactly the integer cents it went in as.
 *
 * This is the invariant the whole app rests on — `CLAUDE.md`: "Money is
 * displayed from integer cents, formatted at the edge — never stored or passed
 * as a float." A `numeric` column, a client that parses through a double, or a
 * PostgREST version that hands back a string would all break it, and all three
 * would be invisible until somebody's balance was off by a cent.
 *
 * The values are written and read back through PostgREST under the caller's own
 * session — the same path the application will use — not over the admin
 * connection, because the admin connection uses a different driver with
 * different number handling and would prove the wrong thing.
 */
export async function assertMoneyRoundTripsAsIntegerCents(
  context: AuthContext,
  label: string,
  values: readonly number[],
): Promise<void> {
  const userId = context.userId
  if (!userId) {
    throw new Error(`assertMoneyRoundTripsAsIntegerCents needs a signed-in context`)
  }

  const rows = values.map((cents, index) => ({
    user_id: userId,
    name: fixtureName(label, `money-${index}`),
    color: 'chart-2' as const,
    balance_cents: cents,
    balance_as_of: '2026-08-15',
  }))

  try {
    // biome-ignore lint/suspicious/noExplicitAny: generic over the generated per-table row types.
    const { data, error } = await (context.client.from('accounts') as any)
      .insert(rows)
      .select('id,name,balance_cents')

    if (error) throw new Error(`could not write the money fixtures: ${error.message}`)
    const written = (data ?? []) as { id: string; name: string; balance_cents: unknown }[]
    if (written.length !== values.length) {
      throw new Error(`wrote ${written.length} money fixtures, expected ${values.length}`)
    }

    const byName = new Map(written.map((row) => [row.name, row]))
    values.forEach((cents, index) => {
      const row = byName.get(fixtureName(label, `money-${index}`))
      if (!row) throw new Error(`money fixture ${index} did not come back`)

      const readBack = row.balance_cents
      if (typeof readBack !== 'number') {
        throw new Error(
          `balance_cents came back as ${typeof readBack}, not a number — ` +
            'something between Postgres and the client is reinterpreting money',
        )
      }
      if (!Number.isInteger(readBack)) {
        throw new Error(`balance_cents for fixture ${index} came back non-integer`)
      }
      if (readBack !== cents) {
        // The values themselves are synthetic and safe to print; without them
        // the failure is unactionable.
        throw new Error(`money fixture ${index} round-tripped ${cents} -> ${readBack}`)
      }
    })

    // And the column really is an integer type, not a numeric that happens to
    // hold whole values today.
    const sql = adminSql()
    try {
      const [column] = await sql<{ data_type: string }[]>`
        select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'accounts' and column_name = 'balance_cents'
      `
      if (column?.data_type !== 'bigint') {
        throw new Error(
          `accounts.balance_cents is ${column?.data_type ?? 'missing'}, expected bigint`,
        )
      }
    } finally {
      await sql.end()
    }
  } finally {
    await removeFixtures(label)
  }
}
