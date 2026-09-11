/**
 * `save_account` and `save_account_balances`
 * (`supabase/migrations/20260911120500_preserve_superseded_balance_readings.sql`)
 * must preserve the reading they are about to overwrite into
 * `public.balance_readings` before writing the new one over it — otherwise a
 * later reading silently rewrites what an earlier one already produced for
 * the days before it, the bug `docs/database/schema.md`'s `balance_readings`
 * section and `domain/projection.ts`'s `readingsFor` exist to fix.
 *
 * Runs under user B's own session, for the same reason
 * `tests/integration/accounts-crud.test.ts` does: A and C are held to
 * `domain/seed.ts` exactly by `tests/rls/seed-fidelity.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AuthContext, secondUserContext } from '../support/auth'
import { LOCAL_STACK } from '../support/database'
import { fixtureName, removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'balance-readings-preservation'

describe.skipIf(LOCAL_STACK === null)(
  'balance readings are preserved before being overwritten',
  () => {
    let context: AuthContext

    beforeAll(async () => {
      await removeFixtures(LABEL)
      context = await secondUserContext()
      if (!context.userId) throw new Error('second-user context has no user id')
    })

    afterAll(async () => {
      if (!LOCAL_STACK) return
      await removeFixtures(LABEL)
    })

    it('save_account preserves the outgoing reading, and leaves it alone when nothing changes', async () => {
      const household = await seedHousehold(context, {
        label: LABEL,
        accounts: [
          {
            id: 'a',
            name: 'save-account',
            balance: 100_000,
            balanceAsOf: '2026-07-01',
            color: 'chart-2',
            isDiscretionarySource: false,
          },
        ],
      })
      const accountId = household.accountIds.get('a')
      if (!accountId) throw new Error('seeded account did not come back with an id')

      // A name-only edit: balance and as-of are unchanged, so nothing should be
      // preserved — there is no outgoing reading, only an outgoing name.
      const renamed = await context.client.rpc('save_account', {
        p_id: accountId,
        p_name: fixtureName(LABEL, 'save-account-renamed'),
        p_color: 'chart-2',
        p_balance_cents: 100_000,
        p_balance_as_of: '2026-07-01',
        p_is_discretionary_source: false,
      })
      expect(renamed.error).toBeNull()

      const { data: afterRename, error: afterRenameError } = await context.client
        .from('balance_readings')
        .select('balance_cents, as_of')
        .eq('account_id', accountId)
      expect(afterRenameError).toBeNull()
      expect(afterRename).toEqual([])

      // A real correction: a later reading, a different number.
      const corrected = await context.client.rpc('save_account', {
        p_id: accountId,
        p_name: fixtureName(LABEL, 'save-account-renamed'),
        p_color: 'chart-2',
        p_balance_cents: 120_000,
        p_balance_as_of: '2026-07-10',
        p_is_discretionary_source: false,
      })
      expect(corrected.error).toBeNull()

      const { data: history, error: historyError } = await context.client
        .from('balance_readings')
        .select('balance_cents, as_of')
        .eq('account_id', accountId)
      expect(historyError).toBeNull()
      expect(history).toEqual([{ balance_cents: 100_000, as_of: '2026-07-01' }])

      const { data: current, error: currentError } = await context.client
        .from('accounts')
        .select('balance_cents, balance_as_of')
        .eq('id', accountId)
        .single()
      expect(currentError).toBeNull()
      expect(current).toEqual({ balance_cents: 120_000, balance_as_of: '2026-07-10' })
    })

    it('save_account_balances preserves the outgoing reading for every account it touches', async () => {
      const household = await seedHousehold(context, {
        label: LABEL,
        accounts: [
          {
            id: 'a',
            name: 'bulk-a',
            balance: 50_000,
            balanceAsOf: '2026-08-01',
            color: 'chart-2',
            isDiscretionarySource: false,
          },
          {
            id: 'b',
            name: 'bulk-b',
            balance: 75_000,
            balanceAsOf: '2026-08-01',
            color: 'chart-3',
            isDiscretionarySource: false,
          },
        ],
      })
      const idA = household.accountIds.get('a')
      const idB = household.accountIds.get('b')
      if (!idA || !idB) throw new Error('seeded accounts did not come back with ids')

      const { error: firstSaveError } = await context.client.rpc('save_account_balances', {
        p_account_ids: [idA, idB],
        // Only A's number actually changes; B resubmits the same figure.
        p_balance_cents: [60_000, 75_000],
        p_as_of: '2026-08-10',
      })
      expect(firstSaveError).toBeNull()

      const { data: historyA } = await context.client
        .from('balance_readings')
        .select('balance_cents, as_of')
        .eq('account_id', idA)
      expect(historyA).toEqual([{ balance_cents: 50_000, as_of: '2026-08-01' }])

      // B's balance did not change, but its as-of moved — still a real reading
      // being superseded, so it is preserved too.
      const { data: historyB } = await context.client
        .from('balance_readings')
        .select('balance_cents, as_of')
        .eq('account_id', idB)
      expect(historyB).toEqual([{ balance_cents: 75_000, as_of: '2026-08-01' }])

      // Resubmitting the exact same (account, day, balance) that is already
      // current is a no-op edit, the same as save_account's name-only case
      // above — nothing was superseded, so nothing new is preserved.
      const { error: secondSaveError } = await context.client.rpc('save_account_balances', {
        p_account_ids: [idA],
        p_balance_cents: [60_000],
        p_as_of: '2026-08-10',
      })
      expect(secondSaveError).toBeNull()

      const { data: historyAAfterSecondSave } = await context.client
        .from('balance_readings')
        .select('balance_cents, as_of')
        .eq('account_id', idA)
      expect(historyAAfterSecondSave).toEqual([{ balance_cents: 50_000, as_of: '2026-08-01' }])
    })
  },
)
