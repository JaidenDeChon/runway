/**
 * Acceptance criteria: a user can write and read only their own dashboard
 * preference rows; a cross-user `account_id` is rejected by the composite
 * foreign key even over the admin connection; deleting an account removes its
 * hidden row by cascade; `user_settings.default_horizon_days` written through
 * a session persists and stays scoped to that session.
 *
 * Runs on **user A's own session** (`validUserContext()`) for the writes under
 * test, never the admin connection — seeding through the RLS-governed client
 * is itself a test of the INSERT/DELETE policies, the same stance
 * `tests/support/fixtures.ts` takes. The probe accounts are named with the
 * `fixture:dashboard-preferences:` prefix and swept by `removeFixtures` in
 * both `beforeAll` and `afterAll`.
 *
 * `user_settings` is A's one real row, not a fixture — `tests/rls/
 * seed-fidelity.test.ts` holds A to `domain/seed.ts` exactly, so the write
 * test restores `default_horizon_days` to its seeded `30` in `afterAll`, the
 * same shape `accounts-crud.test.ts` uses for the discretionary designation.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AuthContext, secondUserContext, validUserContext } from '../support/auth'
import { adminSql, LOCAL_STACK } from '../support/database'
import { fixtureName, removeFixtures } from '../support/fixtures'

const LABEL = 'dashboard-preferences'

describe.skipIf(LOCAL_STACK === null)('dashboard preferences', () => {
  let a: AuthContext
  let userId: string
  /** A's own throwaway account — the row the hidden-set tests hide and show. */
  let accountId: string
  /** B's own throwaway account — never A's to hide, which is the point of it. */
  let bAccountId: string

  beforeAll(async () => {
    await removeFixtures(LABEL)

    a = await validUserContext()
    if (!a.userId) throw new Error('valid-user context has no user id')
    userId = a.userId

    const { data: account, error: accountError } = await a.client
      .from('accounts')
      .insert({
        user_id: userId,
        name: fixtureName(LABEL, 'a-probe'),
        color: 'chart-2',
        balance_cents: 100,
        balance_as_of: '2026-08-15',
      })
      .select('id')
      .single()
    if (accountError || !account) {
      throw new Error(`could not create A's probe account: ${accountError?.message}`)
    }
    accountId = account.id

    const b = await secondUserContext()
    if (!b.userId) throw new Error('second-user context has no user id')
    const { data: bAccount, error: bAccountError } = await b.client
      .from('accounts')
      .insert({
        user_id: b.userId,
        name: fixtureName(LABEL, 'b-probe'),
        color: 'chart-2',
        balance_cents: 100,
        balance_as_of: '2026-08-15',
      })
      .select('id')
      .single()
    if (bAccountError || !bAccount) {
      throw new Error(`could not create B's probe account: ${bAccountError?.message}`)
    }
    bAccountId = bAccount.id
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    // Restored before the fixture accounts are removed, matching
    // accounts-crud.test.ts's ordering — though nothing here references the
    // probe accounts by then, so order is not load-bearing the way it is there.
    await a.client.from('user_settings').update({ default_horizon_days: 30 }).eq('user_id', userId)
    await removeFixtures(LABEL)
  })

  it("lets A write a hidden row for A's own account, and reads back only A's rows", async () => {
    const { error: insertError } = await a.client
      .from('dashboard_hidden_accounts')
      .insert({ user_id: userId, account_id: accountId })
    expect(insertError).toBeNull()

    const { data, error } = await a.client
      .from('dashboard_hidden_accounts')
      .select('account_id, user_id')
    expect(error).toBeNull()
    const rows = data ?? []
    expect(rows.every((row) => row.user_id === userId)).toBe(true)
    expect(rows.some((row) => row.account_id === accountId)).toBe(true)
  })

  it('deleting the row removes it', async () => {
    const { error: deleteError } = await a.client
      .from('dashboard_hidden_accounts')
      .delete()
      .eq('account_id', accountId)
    expect(deleteError).toBeNull()

    const { data, error } = await a.client
      .from('dashboard_hidden_accounts')
      .select('account_id')
      .eq('account_id', accountId)
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it("rejects a hidden row naming another user's account — over A's own session and over the admin connection", async () => {
    // Over A's own session: the WITH CHECK clause alone would pass (user_id =
    // A = auth.uid()), so this is the composite FK doing the rejecting, not
    // RLS — the same claim schema.md makes for recurring_rules and transfers.
    const { error: sessionError } = await a.client
      .from('dashboard_hidden_accounts')
      .insert({ user_id: userId, account_id: bAccountId })
    expect(sessionError).not.toBeNull()

    // Over the admin connection, which bypasses RLS entirely (BYPASSRLS):
    // this is the half a policy could never prove on its own.
    const sql = adminSql()
    try {
      await expect(
        sql`insert into public.dashboard_hidden_accounts (user_id, account_id) values (${userId}, ${bAccountId})`,
      ).rejects.toThrow(/foreign key/i)
    } finally {
      await sql.end()
    }
  })

  it('cascades away a hidden row when the account it names is deleted', async () => {
    const sql = adminSql()
    try {
      const [throwaway] = await sql<{ id: string }[]>`
        insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
        values (${userId}, ${fixtureName(LABEL, 'cascade-target')}, 'chart-3', 100, '2026-08-15')
        returning id
      `
      if (!throwaway) throw new Error('could not create the cascade-target probe account')

      await sql`
        insert into public.dashboard_hidden_accounts (user_id, account_id)
        values (${userId}, ${throwaway.id})
      `
      await sql`delete from public.accounts where id = ${throwaway.id}`

      const [row] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from public.dashboard_hidden_accounts
        where account_id = ${throwaway.id}
      `
      expect(row?.count).toBe('0')
    } finally {
      await sql.end()
    }
  })

  it("default_horizon_days written through A's own session persists, and is scoped to A when read back", async () => {
    const { error: writeError } = await a.client
      .from('user_settings')
      .update({ default_horizon_days: 90 })
      .eq('user_id', userId)
    expect(writeError).toBeNull()

    const { data: reread, error: rereadError } = await a.client
      .from('user_settings')
      .select('default_horizon_days')
      .single()
    expect(rereadError).toBeNull()
    expect(reread?.default_horizon_days).toBe(90)

    // RLS scopes the read: B's own session sees only B's own row, and A's 90
    // is nowhere in it.
    const b = await secondUserContext()
    if (!b.userId) throw new Error('second-user context has no user id')
    const { data: seenByB, error: bError } = await b.client
      .from('user_settings')
      .select('user_id, default_horizon_days')
    expect(bError).toBeNull()
    const rows = seenByB ?? []
    expect(rows.every((row) => row.user_id === b.userId)).toBe(true)
    expect(rows.some((row) => row.default_horizon_days === 90)).toBe(false)
  })
})
