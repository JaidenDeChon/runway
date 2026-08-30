/**
 * Acceptance criterion: "an integration test confirms cross-user isolation"
 * on the `accounts` archive column and the discretionary-source foreign key
 * issue #7 added.
 *
 * `tests/rls/domain-tables.test.ts` already proves the general
 * select/update/delete/insert isolation shape for `accounts` (and every other
 * domain table) against its *pre-existing* columns. This file adds what that
 * one does not cover: the archive column specifically — including that an
 * archived row is no more visible than an active one — and the composite
 * foreign key `user_settings (user_id, discretionary_account_id)` ->
 * `accounts (user_id, id)`, which is a *constraint* failure rather than a
 * policy denial and is the point of the last test below (see "Cross-user
 * integrity" in `docs/database/schema.md`).
 *
 * Same two rules as `cross-user-isolation.test.ts`: probe rows are created and
 * torn down over `adminSql()`, never through a policy-governed client, and
 * every assertion names ids and counts — never a balance.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSql, LOCAL_STACK, signedInClient, USER_A, USER_B } from './helpers'

const PROBE_PREFIX = 'probe:accounts-isolation:'

let archivedForBId: string
let activeForBId: string
let originalADiscretionaryAccountId: string | null

async function removeProbes(): Promise<void> {
  const sql = adminSql()
  try {
    await sql`delete from public.accounts where name like ${`${PROBE_PREFIX}%`}`
  } finally {
    await sql.end()
  }
}

describe.skipIf(LOCAL_STACK === null)(
  'accounts isolation: the archive column and the discretionary FK',
  () => {
    beforeAll(async () => {
      await removeProbes()
      const sql = adminSql()
      try {
        const [archived] = await sql<{ id: string }[]>`
        insert into public.accounts (user_id, name, color, balance_cents, balance_as_of, archived_on)
        values (${USER_B.id}, ${`${PROBE_PREFIX}archived`}, 'chart-2', 100, '2026-06-01', '2026-07-01')
        returning id
      `
        const [active] = await sql<{ id: string }[]>`
        insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
        values (${USER_B.id}, ${`${PROBE_PREFIX}active`}, 'chart-3', 200, '2026-07-01')
        returning id
      `
        if (!archived || !active) throw new Error('could not create the accounts-isolation probes')
        archivedForBId = archived.id
        activeForBId = active.id

        const [settings] = await sql<{ discretionary_account_id: string | null }[]>`
        select discretionary_account_id from public.user_settings where user_id = ${USER_A.id}
      `
        originalADiscretionaryAccountId = settings?.discretionary_account_id ?? null
      } finally {
        await sql.end()
      }
    })

    // Runs even after a failed assertion, so a breach cannot leave debris.
    afterAll(async () => {
      if (!LOCAL_STACK) return
      const sql = adminSql()
      try {
        // Restored in case a bug under test actually let the write through —
        // this file must not leave A's household different from how it found it.
        await sql`
        update public.user_settings set discretionary_account_id = ${originalADiscretionaryAccountId}
        where user_id = ${USER_A.id}
      `
      } finally {
        await sql.end()
      }
      await removeProbes()
    })

    it("shows user A none of user B's accounts, archived ones included", async () => {
      const a = await signedInClient(USER_A)

      const { data: all, error: allError } = await a
        .from('accounts')
        .select('id, user_id')
        .like('name', `${PROBE_PREFIX}%`)
      expect(allError).toBeNull()
      expect(all ?? []).toHaveLength(0)

      const { data: byIdArchived, error: archivedError } = await a
        .from('accounts')
        .select('id')
        .eq('id', archivedForBId)
      expect(archivedError).toBeNull()
      expect(byIdArchived ?? []).toHaveLength(0)

      const { data: byIdActive, error: activeError } = await a
        .from('accounts')
        .select('id')
        .eq('id', activeForBId)
      expect(activeError).toBeNull()
      expect(byIdActive ?? []).toHaveLength(0)
    })

    it("will not let user A archive user B's account", async () => {
      const a = await signedInClient(USER_A)
      const { data: updated, error } = await a
        .from('accounts')
        .update({ archived_on: '2026-08-01' })
        .eq('id', activeForBId)
        .select('id')

      expect(error).toBeNull()
      // The USING clause hides the row from the UPDATE, so it matches nothing
      // rather than erroring.
      expect(updated ?? []).toHaveLength(0)

      const sql = adminSql()
      try {
        const [row] = await sql<{ archived_on: Date | null }[]>`
        select archived_on from public.accounts where id = ${activeForBId}
      `
        expect(row?.archived_on, `account ${activeForBId} should still be active`).toBeNull()
      } finally {
        await sql.end()
      }
    })

    it("will not let user A restore user B's archived account", async () => {
      const a = await signedInClient(USER_A)
      const { data: updated, error } = await a
        .from('accounts')
        .update({ archived_on: null })
        .eq('id', archivedForBId)
        .select('id')

      expect(error).toBeNull()
      expect(updated ?? []).toHaveLength(0)

      const sql = adminSql()
      try {
        const [row] = await sql<{ archived_on: Date | null }[]>`
        select archived_on from public.accounts where id = ${archivedForBId}
      `
        expect(
          row?.archived_on,
          `account ${archivedForBId} should still be archived`,
        ).not.toBeNull()
      } finally {
        await sql.end()
      }
    })

    it("will not let user A point their discretionary source at user B's account", async () => {
      const a = await signedInClient(USER_A)
      const { error } = await a
        .from('user_settings')
        .update({ discretionary_account_id: activeForBId })
        .eq('user_id', USER_A.id)

      // A foreign-key violation on the composite (user_id, discretionary_account_id)
      // -> accounts (user_id, id) key, not a policy denial — the row is entirely
      // visible to A's own UPDATE, it is the *value* that cannot reference
      // another user's account. See "Cross-user integrity" in
      // docs/database/schema.md.
      expect(error).not.toBeNull()

      const sql = adminSql()
      try {
        const [row] = await sql<{ discretionary_account_id: string | null }[]>`
        select discretionary_account_id from public.user_settings where user_id = ${USER_A.id}
      `
        expect(row?.discretionary_account_id ?? null).toBe(originalADiscretionaryAccountId)
      } finally {
        await sql.end()
      }
    })

    it('will not let user A insert an account owned by user B', async () => {
      const a = await signedInClient(USER_A)
      const { error } = await a.from('accounts').insert({
        user_id: USER_B.id,
        name: `${PROBE_PREFIX}planted-by-a`,
        color: 'chart-2',
        balance_cents: 100,
        balance_as_of: '2026-08-01',
      })

      // 42501 is insufficient_privilege — the WITH CHECK clause rejecting the
      // row outright, not a silent no-op.
      expect(error?.code).toBe('42501')
    })
  },
)
