/**
 * The trigger that gives every new account its `user_settings` row.
 *
 * Tested through a **real sign-up** against the local GoTrue rather than by
 * inserting into `auth.users` over the admin connection. That is the whole
 * point: sign-up happens inside the auth server, with no application code path
 * to hang this on, and a test that inserted the row itself would be testing a
 * statement nobody executes in production.
 *
 * The account created here is torn down over the admin connection afterwards,
 * cascading to the settings row it is asserting about.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { adminSql, anonClient, LOCAL_STACK, USER_A } from '../support/database'

/**
 * A fresh address per test, on a domain that cannot receive mail.
 *
 * `runway.test` matches the seed users' domain, so a stray row is recognisable
 * as ours; the random half means two runs in the same minute cannot collide on
 * GoTrue's unique constraint.
 */
function throwawayEmail(): string {
  const unique = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  return `fixture-signup-${unique}@runway.test`
}

/** Long enough for `minimum_password_length`, and worth nothing off this machine. */
const THROWAWAY_PASSWORD = 'runway-local-throwaway'

const created: string[] = []

async function removeCreatedUsers(): Promise<void> {
  if (created.length === 0) return
  const ids = created.splice(0, created.length)
  const sql = adminSql()
  try {
    // Cascades to public.user_settings via the FK on user_id.
    await sql`delete from auth.users where id = any(${ids})`
  } finally {
    await sql.end()
  }
}

describe.skipIf(LOCAL_STACK === null)('user_settings on sign-up', () => {
  afterEach(removeCreatedUsers)

  it('creates exactly one settings row for a brand-new account', async () => {
    const client = anonClient()
    const { data, error } = await client.auth.signUp({
      email: throwawayEmail(),
      password: THROWAWAY_PASSWORD,
    })

    expect(error).toBeNull()
    const userId = data.user?.id
    expect(userId, 'sign-up returned no user').toBeTruthy()
    created.push(userId as string)

    const sql = adminSql()
    try {
      const rows = await sql<
        { cushion_cents: string; default_horizon_days: number; time_zone: string | null }[]
      >`
        select cushion_cents::text, default_horizon_days, time_zone
        from public.user_settings
        where user_id = ${userId as string}
      `

      expect(rows).toHaveLength(1)
      // The column defaults, which is the reason the row is created at all:
      // "what does a new user get" is answered by the schema rather than by
      // whichever reader gets there first.
      expect(rows[0]?.cushion_cents).toBe('60000')
      expect(rows[0]?.default_horizon_days).toBe(30)
      // Null, never a device-derived zone — see docs/database/schema.md.
      expect(rows[0]?.time_zone).toBeNull()
    } finally {
      await sql.end()
    }
  })

  it('lets the new account read its own settings row through the API', async () => {
    // Not the same assertion as the one above. That one proves the row exists;
    // this proves the new user's *session* can see it — the row is useless if
    // `user_settings_select_own` does not match it.
    const client = anonClient()
    const { data, error: signUpError } = await client.auth.signUp({
      email: throwawayEmail(),
      password: THROWAWAY_PASSWORD,
    })
    expect(signUpError).toBeNull()
    const userId = data.user?.id
    expect(userId).toBeTruthy()
    created.push(userId as string)

    // Locally `enable_confirmations` is off, so sign-up returns a live session
    // and the client below is already authenticated as the new user.
    expect(data.session, 'local sign-up should return a session').toBeTruthy()

    const { data: settings, error } = await client
      .from('user_settings')
      .select('user_id, cushion_cents')

    expect(error).toBeNull()
    expect(settings).toEqual([{ user_id: userId, cushion_cents: 60000 }])
  })

  it('leaves the seeded users holding their seeded settings, not the defaults', async () => {
    // The trigger fires during `supabase db reset` too, when seed.sql inserts
    // auth.users. Its `on conflict do nothing` plus the seed's own upsert must
    // leave the seed as the authority — otherwise every fixture quietly becomes
    // a 60000/30 default and `tests/rls/seed-fidelity.test.ts` starts lying.
    const sql = adminSql()
    try {
      const rows = await sql<{ cushion_cents: string; monthly_discretionary_cents: string }[]>`
        select cushion_cents::text, monthly_discretionary_cents::text
        from public.user_settings where user_id = ${USER_A.id}
      `
      expect(rows).toHaveLength(1)
      // domain/seed.ts's figures, mirrored by supabase/seed.sql.
      expect(rows[0]?.cushion_cents).toBe('60000')
      expect(rows[0]?.monthly_discretionary_cents).toBe('103400')
    } finally {
      await sql.end()
    }
  })
})
