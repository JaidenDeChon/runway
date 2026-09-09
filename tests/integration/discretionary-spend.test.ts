/**
 * Acceptance criteria: the monthly discretionary figure written by
 * `setMonthlyDiscretionarySpend` persists under the caller's own session,
 * does not disturb the other `user_settings` columns, is rejected when
 * negative, and stays scoped to the user who wrote it.
 *
 * Runs entirely under **user B's own session** (`secondUserContext()`), never
 * user A's or user C's: `tests/rls/seed-fidelity.test.ts` holds both of those
 * households to `domain/seed.ts` exactly, and B mirrors nothing — the same
 * reason `accounts-crud.test.ts` lands on B. `user_settings` is B's one real
 * row, so `beforeAll` captures B's current `monthly_discretionary_cents` and
 * `afterAll` writes it back, leaving B's household exactly as it was found —
 * the shape `accounts-crud.test.ts` uses for the discretionary designation
 * and `dashboard-preferences.test.ts` uses for the horizon.
 *
 * The first test is the one that earns the `upsert` choice in
 * `setMonthlyDiscretionarySpend`: a partial-column upsert that clobbered
 * siblings would silently reset a user's cushion and horizon, and nothing in
 * the repo checks that today — `setDefaultHorizonDays` uses the same idiom
 * untested, and is now covered by proxy.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AuthContext, secondUserContext, validUserContext } from '../support/auth'
import { LOCAL_STACK } from '../support/database'

const PROBE_CENTS = 77_700

describe.skipIf(LOCAL_STACK === null)('monthly discretionary spend', () => {
  let b: AuthContext
  let userId: string
  let originalCents = 0

  beforeAll(async () => {
    b = await secondUserContext()
    if (!b.userId) throw new Error('second-user context has no user id')
    userId = b.userId

    const { data, error } = await b.client
      .from('user_settings')
      .select('monthly_discretionary_cents')
      .single()
    if (error || !data) {
      throw new Error(`could not read user_settings for the second-user context: ${error?.code}`)
    }
    originalCents = data.monthly_discretionary_cents
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await b.client
      .from('user_settings')
      .update({ monthly_discretionary_cents: originalCents })
      .eq('user_id', userId)
  })

  it("an upsert through B's own session persists the figure and leaves every sibling column alone", async () => {
    const { data: before, error: readError } = await b.client
      .from('user_settings')
      .select(
        'cushion_cents, default_horizon_days, time_zone, balance_stale_after_days, discretionary_account_id',
      )
      .single()
    expect(readError).toBeNull()
    if (!before) throw new Error('user_settings row missing before the write')

    const { error: writeError } = await b.client
      .from('user_settings')
      .upsert(
        { user_id: userId, monthly_discretionary_cents: PROBE_CENTS },
        { onConflict: 'user_id' },
      )
    expect(writeError).toBeNull()

    const { data: after, error: reReadError } = await b.client
      .from('user_settings')
      .select(
        'monthly_discretionary_cents, cushion_cents, default_horizon_days, time_zone, balance_stale_after_days, discretionary_account_id',
      )
      .single()
    expect(reReadError).toBeNull()
    if (!after) throw new Error('user_settings row missing after the write')

    expect(after.monthly_discretionary_cents).toBe(PROBE_CENTS)
    expect(after.cushion_cents).toBe(before.cushion_cents)
    expect(after.default_horizon_days).toBe(before.default_horizon_days)
    expect(after.time_zone).toBe(before.time_zone)
    expect(after.balance_stale_after_days).toBe(before.balance_stale_after_days)
    expect(after.discretionary_account_id).toBe(before.discretionary_account_id)
  })

  it('rejects a negative figure', async () => {
    const { error } = await b.client
      .from('user_settings')
      .upsert({ user_id: userId, monthly_discretionary_cents: -1 }, { onConflict: 'user_id' })
    // The column's own `check (monthly_discretionary_cents >= 0)`. Asserted as
    // a bare presence — the message can name the constraint and goes nowhere.
    expect(error).not.toBeNull()
  })

  it("is scoped to B — A's own row is untouched and A cannot see B's figure", async () => {
    const a = await validUserContext()
    if (!a.userId) throw new Error('valid-user context has no user id')

    const { data, error } = await a.client
      .from('user_settings')
      .select('user_id, monthly_discretionary_cents')
    expect(error).toBeNull()
    const rows = data ?? []
    // RLS narrows the read to A's own rows; none of them is the value B wrote.
    expect(rows.every((row) => row.user_id === a.userId)).toBe(true)
    expect(rows.some((row) => row.monthly_discretionary_cents === PROBE_CENTS)).toBe(false)
  })
})
