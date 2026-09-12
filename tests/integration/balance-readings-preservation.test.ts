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
import {
  ACCOUNT_COLUMNS,
  BALANCE_READING_COLUMNS,
  toAccount,
  toBalanceHistory,
} from '~~/app/lib/supabase/accounts'
import { project } from '~~/domain/projection'
import type { RunwayData } from '~~/domain/types'
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

    it('a same-day correction replaces the preserved reading instead of being discarded by a later conflict', async () => {
      // Regression for a real data-loss bug: `on conflict ... do nothing`
      // kept whichever value was preserved *first* for a day, so a same-day
      // typo fix was silently overwritten back to the wrong figure the next
      // time a later reading tried to preserve that same day again.
      const household = await seedHousehold(context, {
        label: LABEL,
        accounts: [
          {
            id: 'a',
            name: 'same-day-correction',
            balance: 214_000,
            balanceAsOf: '2026-08-15',
            color: 'chart-2',
            isDiscretionarySource: false,
          },
        ],
      })
      const accountId = household.accountIds.get('a')
      if (!accountId) throw new Error('seeded account did not come back with an id')

      const save = (balance: number, asOf: string) =>
        context.client.rpc('save_account', {
          p_id: accountId,
          p_name: 'same-day-correction',
          p_color: 'chart-2',
          p_balance_cents: balance,
          p_balance_as_of: asOf,
          p_is_discretionary_source: false,
        })

      // A balance edit today, preserving the 08-15 reading.
      expect((await save(220_000, '2026-09-09')).error).toBeNull()
      // A same-day typo fix: 09-09's own reading is not yet on file, so this
      // preserves 220_000 for 09-09 for the first time.
      expect((await save(225_000, '2026-09-09')).error).toBeNull()
      // The next day's reading tries to preserve 09-09 again — this is the
      // conflict `on conflict ... do nothing` used to lose.
      expect((await save(230_000, '2026-09-10')).error).toBeNull()

      const { data: history, error: historyError } = await context.client
        .from('balance_readings')
        .select('balance_cents, as_of')
        .eq('account_id', accountId)
        .order('as_of', { ascending: true })
      expect(historyError).toBeNull()
      expect(history).toEqual([
        { balance_cents: 214_000, as_of: '2026-08-15' },
        // The typo-corrected 225_000, not the discarded 220_000.
        { balance_cents: 225_000, as_of: '2026-09-09' },
      ])
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

    it('a household read the way useRunwayData reads it projects correctly through pre-existing history', async () => {
      // Exercises the seam end to end: `balance_readings` seeded directly —
      // as a future bank sync or an import would, bypassing the RPCs
      // entirely — read back through the exact column lists and mapping
      // functions `useRunwayData.ts` uses, and fed into the projection
      // engine. `domain/projection.test.ts` proves the algorithm against
      // hand-built `RunwayData`; this proves the same shape survives a real
      // round trip through Postgres and PostgREST.
      const household = await seedHousehold(context, {
        label: LABEL,
        accounts: [
          {
            id: 'a',
            name: 'end-to-end',
            balance: 650_000,
            balanceAsOf: '2026-06-10',
            color: 'chart-2',
            isDiscretionarySource: false,
          },
        ],
        balanceHistory: [{ accountId: 'a', balance: 500_000, asOf: '2026-06-01' }],
      })
      const accountId = household.accountIds.get('a')
      if (!accountId) throw new Error('seeded account did not come back with an id')

      const [accountsResult, historyResult] = await Promise.all([
        context.client.from('accounts').select(ACCOUNT_COLUMNS).eq('id', accountId),
        context.client
          .from('balance_readings')
          .select(BALANCE_READING_COLUMNS)
          .eq('account_id', accountId)
          .order('as_of', { ascending: true }),
      ])
      expect(accountsResult.error).toBeNull()
      expect(historyResult.error).toBeNull()

      const account = (accountsResult.data ?? []).map((row) => toAccount(row, null))[0]
      if (!account) throw new Error('account did not come back from the read')

      const data: RunwayData = {
        accounts: [account],
        recurringItems: [],
        transfers: [],
        balanceHistory: toBalanceHistory(historyResult.data),
        monthlyDiscretionarySpend: 0,
        safetyCushion: 0,
        timeZone: null,
      }

      const projection = project(data, { start: '2026-06-01', end: '2026-06-12' })
      // 9 days at the superseded 500_000 (06-01 through 06-09), unmoved by the
      // later reading, then 650_000 from 06-10 — its own day — onward.
      expect(projection.combined.map((point) => point.balance)).toEqual([
        ...Array(9).fill(500_000),
        ...Array(3).fill(650_000),
      ])
    })
  },
)
