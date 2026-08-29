/**
 * Acceptance criterion: "a forged `user_id` in a request body cannot access
 * another user's data."
 *
 * This is the data-layer half, and it is the half that matters most. The
 * application half — a Nitro handler that reads no `user_id` parameter at all —
 * is covered end-to-end in `tests/e2e/authentication.spec.ts`, against the
 * running server. Both are needed and they prove different things:
 *
 * - The E2E test proves *this* handler does not read a client-supplied id.
 * - This file proves it would not matter if a future one did. Every request
 *   carries a session, PostgREST turns that session into `auth.uid()`, and the
 *   policies are written against `auth.uid()` rather than against whatever the
 *   query said. An application bug is contained by the database rather than
 *   escalated by it.
 *
 * The forgery is performed the way an attacker would: not by editing the
 * database, but by putting somebody else's id in the payload of an otherwise
 * ordinary, correctly authenticated request. Everything here is done with a
 * *real* session for user A — never the admin connection, which holds
 * `BYPASSRLS` and would prove nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expiredSessionContext, unauthenticatedContext, validUserContext } from '../support/auth'
import { adminSql, LOCAL_STACK, signedInClient, USER_A, USER_B } from '../support/database'

/** Prefixed so a run that dies mid-test leaves debris the next one sweeps. */
const FORGERY_PREFIX = 'fixture:forgery:'

async function removeForgeries(): Promise<void> {
  const sql = adminSql()
  try {
    await sql`delete from public.accounts where name like ${`${FORGERY_PREFIX}%`}`
  } finally {
    await sql.end()
  }
}

describe.skipIf(LOCAL_STACK === null)('a forged user_id cannot cross users', () => {
  beforeAll(removeForgeries)
  // Runs even after a failed assertion, so a successful forgery cannot survive
  // the run that caught it.
  afterAll(removeForgeries)

  it('refuses a write that claims another user owns the row', async () => {
    const a = await signedInClient(USER_A)

    const { data, error } = await a
      .from('accounts')
      .insert({
        // The forgery. Everything else about this request is legitimate.
        user_id: USER_B.id,
        name: `${FORGERY_PREFIX}planted-on-b`,
        color: 'chart-2',
        balance_cents: 1_000,
        balance_as_of: '2026-08-27',
      })
      .select('id')

    expect(error).not.toBeNull()
    expect(data).toBeNull()
    // 42501 is `insufficient_privilege` — the WITH CHECK on
    // `accounts_insert_own` rejected the row because `auth.uid()` is A's id and
    // the row claimed B's. See docs/database/rls.md.
    expect(error?.code).toBe('42501')
  })

  it('leaves no row behind when the forgery is refused', async () => {
    // The insert above must not have half-succeeded. Checked over the admin
    // connection, because the question is "does this row exist at all", which a
    // policy-governed read cannot answer.
    const sql = adminSql()
    try {
      const rows = await sql<{ count: string }[]>`
        select count(*)::text as count from public.accounts
        where name like ${`${FORGERY_PREFIX}%`}
      `
      expect(rows[0]?.count).toBe('0')
    } finally {
      await sql.end()
    }
  })

  it('refuses to reassign a row the caller does own to somebody else', async () => {
    // The other direction, and the one a `USING`-only policy would allow:
    // take a row you legitimately own and hand it to another user.
    const a = await signedInClient(USER_A)

    const { data: mine } = await a.from('accounts').select('id').limit(1)
    const target = mine?.[0]?.id
    expect(target, 'user A must own at least one seeded account').toBeTruthy()

    const { data, error } = await a
      .from('accounts')
      .update({ user_id: USER_B.id })
      .eq('id', target as string)
      .select('id')

    // Rejected by the WITH CHECK half of `accounts_update_own`.
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('returns nothing when a read filters for another user explicitly', async () => {
    // The read-side forgery: ask, in so many words, for B's rows. The filter is
    // applied *on top of* the policy, never instead of it.
    const a = await signedInClient(USER_A)

    const { data, error } = await a
      .from('user_settings')
      .select('user_id, cushion_cents')
      .eq('user_id', USER_B.id)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('scopes an unfiltered read to the caller, whatever the query asked for', async () => {
    // The complement of the case above: no filter at all is still one user's
    // rows. `user_settings` is one row per user, so this is exact.
    const a = await signedInClient(USER_A)

    const { data, error } = await a.from('user_settings').select('user_id')

    expect(error).toBeNull()
    expect(data).toEqual([{ user_id: USER_A.id }])
  })

  it('gives an expired session no data, rather than an error the app must special-case', async () => {
    // "Expired session redirects rather than erroring" needs the data layer to
    // answer unambiguously: a 401 with a code, not a partial read.
    const expired = await expiredSessionContext()
    if (!expired) {
      // The local signing secret could not be verified, so the token minted
      // would fail for the wrong reason. Skipping is honest; asserting on a
      // malformed token would not be the same test.
      return
    }

    const result = await expired.restSelect('user_settings', 'user_id')
    expect(result.status).toBe(401)
    expect(result.rows).toEqual([])
  })

  it('gives an unauthenticated caller nothing, with or without a user_id in hand', async () => {
    const anonymous = unauthenticatedContext()

    const result = await anonymous.restSelect('user_settings', 'user_id')
    expect(result.rows).toEqual([])
    // `anon` holds no privilege on the table at all (layer 1 of the
    // deny-by-default posture), so this never reaches a policy.
    expect(result.status).not.toBe(200)
  })

  it('agrees with the session context helper about who the caller is', async () => {
    // Ties this file to the shared auth contexts: the id RLS enforces is the id
    // the session says, and both are user A's.
    const valid = await validUserContext()
    const rows = await valid.restSelect('user_settings', 'user_id')

    expect(rows.status).toBe(200)
    expect(rows.rows).toEqual([{ user_id: USER_A.id }])
    expect(valid.userId).toBe(USER_A.id)
  })
})
