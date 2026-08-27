/**
 * The first server-side read of a user's own data, and the worked example of
 * how every later one must be written.
 *
 * `user_settings` is the natural first row to read: there is exactly one per
 * user, it exists from the moment the account does (see the trigger in
 * `supabase/migrations/*_user_settings_on_signup.sql`), and it carries nothing
 * a log would be embarrassed to lose — a cushion, a horizon, a timezone.
 *
 * Three properties, in the order they matter:
 *
 * 1. **`user_id` comes from the session.** `requireUser()` validated a token
 *    against the auth server; the id below is that user's. This handler reads
 *    no parameter at all, so a forged `?user_id=` or a forged body field has
 *    nothing to attach to. That is the acceptance criterion, and
 *    `tests/integration/session-scoping.test.ts` proves it by trying.
 * 2. **The filter is not the boundary.** `.eq('user_id', user.id)` is written
 *    for the query planner's benefit and for the reader's. What actually stops
 *    a cross-user read is RLS: this client holds the anon key plus the caller's
 *    session, so `user_settings_select_own` is evaluated against their
 *    `auth.uid()`. Delete the filter and the answer would be the same. That
 *    redundancy is the design — see `docs/database/rls.md`.
 * 3. **No service-role key.** It has no reader in this codebase and must not
 *    acquire one here: it holds `BYPASSRLS`, and property 2 evaporates with it.
 *
 * The columns are named rather than `select('*')` so a column added later is a
 * deliberate addition to this response, not an automatic one.
 */

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const client = serverSupabaseClient(event)

  const { data, error } = await client
    .from('user_settings')
    .select(
      'user_id, cushion_cents, monthly_discretionary_cents, discretionary_account_id, default_horizon_days, time_zone',
    )
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    // The database's own message can name columns, constraints and policies.
    // It goes nowhere near the response, and no row content is logged.
    console.error('user-settings read failed', { userId: user.id, code: error.code })
    throw createError({ statusCode: 500, statusMessage: 'Could not load your settings.' })
  }

  // `null` is a real answer for an account created before the trigger existed.
  // The caller decides what to do about it; inventing defaults here would hide
  // a missing row behind plausible numbers.
  return { settings: data }
})
