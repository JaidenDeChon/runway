/**
 * Regression test for an adversarial-review finding on `useRunwayData.ts`'s
 * old `saveAccount`: the account insert and the follow-up `user_settings`
 * update were two separate PostgREST requests, so a failure in the second
 * left the first's row committed and orphaned — and because the caller never
 * learned the new id, retrying inserted a *second* row.
 *
 * The fix is `public.save_account`
 * (`supabase/migrations/20260831011511_accounts_atomic_writes.sql`), a single
 * RPC whose body is one transaction: both writes land, or neither does.
 *
 * This test forces the second write to fail — the same technique
 * `tests/rls/negative-control.test.ts` uses — by revoking `update` on
 * `public.user_settings` from `authenticated`, then calling `save_account`
 * with `p_is_discretionary_source: true` so the function must touch that
 * table. If the fix ever regresses to two separate statements (or the
 * function stops being atomic some other way), this reproduces exactly the
 * finding: the account row survives the user_settings failure.
 *
 * Confirmed to fail without the fix: with this migration and the
 * `useRunwayData.ts` RPC call both reverted and `bun run db:reset` re-run,
 * `save_account` does not exist and the call errors with "Could not find the
 * function" (PGRST202) before any row is written — the test cannot pass
 * against the pre-fix code, because the RPC this test depends on is the fix.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AuthContext, secondUserContext } from '../support/auth'
import { adminSql, LOCAL_STACK } from '../support/database'
import { fixtureName, removeFixtures } from '../support/fixtures'

const LABEL = 'save-account-atomicity'

async function revokeUserSettingsUpdate(): Promise<void> {
  const sql = adminSql()
  try {
    await sql.unsafe('revoke update on public.user_settings from authenticated')
  } finally {
    await sql.end()
  }
}

async function restoreUserSettingsUpdate(): Promise<void> {
  const sql = adminSql()
  try {
    await sql.unsafe('grant update on public.user_settings to authenticated')
  } finally {
    await sql.end()
  }
}

describe.skipIf(LOCAL_STACK === null)('save_account is atomic', () => {
  let context: AuthContext
  let userId: string
  let originalDiscretionaryAccountId: string | null = null

  beforeAll(async () => {
    await removeFixtures(LABEL)
    context = await secondUserContext()
    if (!context.userId) throw new Error('second-user context has no user id')
    userId = context.userId

    const { data: settings, error } = await context.client
      .from('user_settings')
      .select('discretionary_account_id')
      .single()
    if (error || !settings) {
      throw new Error(`could not read user_settings for the second-user context: ${error?.message}`)
    }
    originalDiscretionaryAccountId = settings.discretionary_account_id
  })

  // Runs even if an assertion above threw mid-test. Leaving the revoke behind
  // would silently break every other suite's writes to user_settings, and
  // leaving the designation behind would corrupt the household
  // tests/rls/seed-fidelity.test.ts holds to domain/seed.ts exactly.
  afterAll(async () => {
    if (!LOCAL_STACK) return
    await restoreUserSettingsUpdate()
    // Restored before the fixture accounts are removed: the designation's
    // foreign key would otherwise be nulled by ON DELETE SET NULL before this
    // write could point it back.
    await context.client
      .from('user_settings')
      .update({ discretionary_account_id: originalDiscretionaryAccountId })
      .eq('user_id', userId)
    await removeFixtures(LABEL)
  })

  it('leaves no account row when the discretionary-designation write fails', async () => {
    const name = fixtureName(LABEL, 'orphan-probe')

    await revokeUserSettingsUpdate()
    try {
      const { data, error } = await context.client.rpc('save_account', {
        p_id: null as unknown as string,
        p_name: name,
        p_color: 'chart-2',
        p_balance_cents: 1_234,
        p_balance_as_of: '2026-07-01',
        // Forces save_account to write to user_settings, which the revoke
        // above turns into a permission failure inside the same transaction
        // as the account insert.
        p_is_discretionary_source: true,
      })

      expect(error, 'the RPC should fail once user_settings is unwritable').not.toBeNull()
      expect(data).toBeNull()
    } finally {
      await restoreUserSettingsUpdate()
    }

    // The account insert ran in the same transaction as the failed
    // user_settings write. If save_account were two statements instead of
    // one function call, this would find the orphaned row the finding named.
    const sql = adminSql()
    try {
      const rows = await sql<{ id: string }[]>`
        select id from public.accounts where name = ${name}
      `
      expect(rows, 'no account should exist after an atomic save_account failure').toHaveLength(0)
    } finally {
      await sql.end()
    }
  })

  it('retrying after a failed save does not duplicate the account', async () => {
    const name = fixtureName(LABEL, 'retry-probe')

    // First attempt fails atomically, exactly like the test above.
    await revokeUserSettingsUpdate()
    const first = await context.client.rpc('save_account', {
      p_id: null as unknown as string,
      p_name: name,
      p_color: 'chart-3',
      p_balance_cents: 500,
      p_balance_as_of: '2026-07-01',
      p_is_discretionary_source: true,
    })
    expect(first.error).not.toBeNull()
    await restoreUserSettingsUpdate()

    // The caller (mirroring AccountEditor, whose `props.account` is still
    // `null` after a failed save) retries with p_id still null.
    const second = await context.client.rpc('save_account', {
      p_id: null as unknown as string,
      p_name: name,
      p_color: 'chart-3',
      p_balance_cents: 500,
      p_balance_as_of: '2026-07-01',
      p_is_discretionary_source: true,
    })
    expect(second.error).toBeNull()

    const sql = adminSql()
    try {
      const rows = await sql<{ id: string }[]>`
        select id from public.accounts where name = ${name}
      `
      expect(rows, 'exactly one account should exist, not a duplicate from the retry').toHaveLength(
        1,
      )
    } finally {
      await sql.end()
    }
  })
})

describe.skipIf(LOCAL_STACK === null)('save_account_balances is atomic', () => {
  let context: AuthContext

  beforeAll(async () => {
    await removeFixtures(LABEL)
    context = await secondUserContext()
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeFixtures(LABEL)
  })

  it('updates every named account in one call', async () => {
    const nameOne = fixtureName(LABEL, 'balances-one')
    const nameTwo = fixtureName(LABEL, 'balances-two')

    const { data: inserted, error: insertError } = await context.client
      .from('accounts')
      .insert([
        {
          user_id: context.userId as string,
          name: nameOne,
          color: 'chart-2',
          balance_cents: 1_000,
          balance_as_of: '2026-07-01',
        },
        {
          user_id: context.userId as string,
          name: nameTwo,
          color: 'chart-3',
          balance_cents: 2_000,
          balance_as_of: '2026-07-01',
        },
      ])
      .select('id')
    expect(insertError).toBeNull()
    if (inserted?.length !== 2) throw new Error('setup insert did not return two ids')

    const { data: saved, error: saveError } = await context.client.rpc('save_account_balances', {
      p_account_ids: inserted.map((row) => row.id),
      p_balance_cents: [1_500, 2_500],
      p_as_of: '2026-08-01',
    })
    expect(saveError).toBeNull()
    expect(saved).toHaveLength(2)

    const { data: reread, error: rereadError } = await context.client
      .from('accounts')
      .select('id, balance_cents, balance_as_of')
      .in(
        'id',
        inserted.map((row) => row.id),
      )
      .order('balance_cents', { ascending: true })
    expect(rereadError).toBeNull()
    expect(reread).toEqual([
      { id: inserted[0]?.id, balance_cents: 1_500, balance_as_of: '2026-08-01' },
      { id: inserted[1]?.id, balance_cents: 2_500, balance_as_of: '2026-08-01' },
    ])
  })

  /**
   * Regression test: mismatched array lengths must not silently write a
   * partial or `NULL`-padded update. Confirmed to fail without the fix — with
   * the migration and the `useRunwayData.ts` RPC call both reverted and
   * `bun run db:reset` re-run, `save_account_balances` does not exist and the
   * call errors with "Could not find the function" (PGRST202) rather than the
   * length-mismatch message this test asserts on, so the test cannot pass
   * against the pre-fix code.
   */
  it('rejects mismatched account/balance arrays before writing anything', async () => {
    const name = fixtureName(LABEL, 'balances-mismatch')

    const { data: inserted, error: insertError } = await context.client
      .from('accounts')
      .insert({
        user_id: context.userId as string,
        name,
        color: 'chart-4',
        balance_cents: 999,
        balance_as_of: '2026-07-01',
      })
      .select('id')
      .single()
    expect(insertError).toBeNull()
    if (!inserted) throw new Error('setup insert did not return an id')

    const { error: saveError } = await context.client.rpc('save_account_balances', {
      p_account_ids: [inserted.id],
      p_balance_cents: [111, 222],
      p_as_of: '2026-08-01',
    })
    expect(saveError, 'mismatched array lengths should be rejected').not.toBeNull()

    const { data: reread, error: rereadError } = await context.client
      .from('accounts')
      .select('balance_cents, balance_as_of')
      .eq('id', inserted.id)
      .single()
    expect(rereadError).toBeNull()
    expect(reread?.balance_cents).toBe(999)
    expect(reread?.balance_as_of).toBe('2026-07-01')
  })
})
