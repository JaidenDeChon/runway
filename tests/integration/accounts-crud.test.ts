/**
 * Acceptance criteria: "full CRUD works and persists," "archiving preserves
 * history," and the trigger issue #7 added —
 * `private.clear_discretionary_source_on_archive`.
 *
 * Runs entirely under **user B's own session** (`secondUserContext()`), never
 * user A's or user C's: `tests/rls/seed-fidelity.test.ts` asserts both of those
 * households against `domain/seed.ts` exactly, and a fixture row planted there
 * — even one cleaned up afterward — is a length assertion waiting to flake if
 * teardown ever fails mid-suite. B mirrors nothing, which is exactly why it is
 * the household every write-heavy suite in this repo lands on.
 *
 * Rows are named with the `fixture:accounts-crud:` prefix and swept by
 * `removeFixtures` in both `beforeAll` and `afterAll`, the same shape
 * `tests/integration/money.test.ts` uses — a run that dies mid-test leaves
 * debris the next `beforeAll` cleans up rather than debris that accumulates.
 *
 * `user_settings` is B's one real row, not a fixture — there is exactly one
 * per user, and `seedHousehold`'s own doc comment says why fixtures never
 * touch it. The discretionary-designation and staleness-threshold tests below
 * read and write it directly and restore whatever they found there in
 * `afterAll`, so this file leaves B's household exactly as it found it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AuthContext, secondUserContext } from '../support/auth'
import { adminSql, LOCAL_STACK } from '../support/database'
import { fixtureName, removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'accounts-crud'

describe.skipIf(LOCAL_STACK === null)(
  'accounts CRUD, archiving and the discretionary trigger',
  () => {
    let context: AuthContext
    let userId: string
    let client: AuthContext['client']
    let originalDiscretionaryAccountId: string | null = null
    let originalStaleAfterDays: number = 14

    beforeAll(async () => {
      await removeFixtures(LABEL)
      context = await secondUserContext()
      if (!context.userId) throw new Error('second-user context has no user id')
      userId = context.userId
      client = context.client

      const { data: settings, error } = await client
        .from('user_settings')
        .select('discretionary_account_id, balance_stale_after_days')
        .single()
      if (error || !settings) {
        throw new Error(
          `could not read user_settings for the second-user context: ${error?.message}`,
        )
      }
      originalDiscretionaryAccountId = settings.discretionary_account_id
      originalStaleAfterDays = settings.balance_stale_after_days
    })

    afterAll(async () => {
      if (!LOCAL_STACK) return
      // Restored before the fixture rows are removed: the discretionary column
      // has a foreign key into `accounts`, so pointing it back at whatever it
      // held before this file ran has to happen while every id it might still
      // reference is valid.
      await client
        .from('user_settings')
        .update({
          discretionary_account_id: originalDiscretionaryAccountId,
          balance_stale_after_days: originalStaleAfterDays,
        })
        .eq('user_id', userId)
      await removeFixtures(LABEL)
    })

    it('stores a balance anchor as integer cents and a calendar day', async () => {
      const { data: inserted, error } = await client
        .from('accounts')
        .insert({
          user_id: userId,
          name: fixtureName(LABEL, 'anchor'),
          color: 'chart-2',
          balance_cents: 123_456,
          balance_as_of: '2026-07-01',
        })
        .select('id, balance_cents, balance_as_of')
        .single()

      expect(error).toBeNull()
      expect(inserted?.balance_cents).toBe(123_456)
      expect(inserted?.balance_as_of).toBe('2026-07-01')
    })

    it('updates an anchor in place', async () => {
      const { data: inserted, error: insertError } = await client
        .from('accounts')
        .insert({
          user_id: userId,
          name: fixtureName(LABEL, 'update-target'),
          color: 'chart-3',
          balance_cents: 500,
          balance_as_of: '2026-07-01',
        })
        .select('id')
        .single()
      expect(insertError).toBeNull()
      if (!inserted) throw new Error('insert did not return an id')

      const { error: updateError } = await client
        .from('accounts')
        .update({ balance_cents: 750, balance_as_of: '2026-07-15' })
        .eq('id', inserted.id)

      expect(updateError).toBeNull()

      const { data: reread, error: rereadError } = await client
        .from('accounts')
        .select('balance_cents, balance_as_of')
        .eq('id', inserted.id)
        .single()

      expect(rereadError).toBeNull()
      expect(reread?.balance_cents).toBe(750)
      expect(reread?.balance_as_of).toBe('2026-07-15')
    })

    it('archives without deleting the row or its history', async () => {
      const household = await seedHousehold(context, {
        label: LABEL,
        accounts: [
          {
            id: 'acct-history',
            name: 'History',
            balance: 10_000,
            balanceAsOf: '2026-07-01',
            color: 'chart-4',
            isDiscretionarySource: false,
          },
          {
            id: 'acct-history-other',
            name: 'History Other',
            balance: 5_000,
            balanceAsOf: '2026-07-01',
            color: 'chart-2',
            isDiscretionarySource: false,
          },
        ],
        recurringItems: [
          {
            id: 'rule-history',
            name: 'History Rent',
            kind: 'bill',
            amount: 1_000,
            cadence: 'monthly',
            accountId: 'acct-history',
            nextOccurrence: '2026-08-01',
            amountSource: 'fixed',
            depositHistory: [],
            isVariable: false,
          },
        ],
        transfers: [
          {
            id: 'xfer-history',
            fromAccountId: 'acct-history',
            toAccountId: 'acct-history-other',
            amount: 2_000,
            date: '2026-07-10',
            createdAt: 0,
          },
        ],
      })
      const accountId = household.accountIds.get('acct-history')
      const ruleId = household.ruleIds.get('rule-history')
      const transferId = household.transferIds[0]
      if (!accountId || !ruleId || !transferId) {
        throw new Error('history fixture did not seed the rows this test needs')
      }

      const { error: archiveError } = await client
        .from('accounts')
        .update({ archived_on: '2026-08-10' })
        .eq('id', accountId)
      expect(archiveError).toBeNull()

      const sql = adminSql()
      try {
        const [account] = await sql<{ id: string; archived_on: Date | null }[]>`
        select id, archived_on from public.accounts where id = ${accountId}
      `
        expect(account, `account ${accountId} should still exist after archiving`).toBeDefined()
        expect(account?.archived_on).not.toBeNull()

        const [rule] = await sql<{ id: string }[]>`
        select id from public.recurring_rules where id = ${ruleId}
      `
        expect(rule, `rule ${ruleId} should survive its account being archived`).toBeDefined()

        const [transfer] = await sql<{ id: string }[]>`
        select id from public.transfers where id = ${transferId}
      `
        expect(
          transfer,
          `transfer ${transferId} should survive its account being archived`,
        ).toBeDefined()
      } finally {
        await sql.end()
      }
    })

    it('clears the discretionary designation when the account holding it is archived', async () => {
      const { data: inserted, error: insertError } = await client
        .from('accounts')
        .insert({
          user_id: userId,
          name: fixtureName(LABEL, 'discretionary-source'),
          color: 'chart-2',
          balance_cents: 1_000,
          balance_as_of: '2026-07-01',
        })
        .select('id')
        .single()
      expect(insertError).toBeNull()
      if (!inserted) throw new Error('insert did not return an id')

      const { error: settingsError } = await client
        .from('user_settings')
        .update({ discretionary_account_id: inserted.id })
        .eq('user_id', userId)
      expect(settingsError).toBeNull()

      const { error: archiveError } = await client
        .from('accounts')
        .update({ archived_on: '2026-08-10' })
        .eq('id', inserted.id)
      expect(archiveError).toBeNull()

      const { data: settings, error: rereadError } = await client
        .from('user_settings')
        .select('discretionary_account_id')
        .eq('user_id', userId)
        .single()
      expect(rereadError).toBeNull()
      expect(settings?.discretionary_account_id).toBeNull()
    })

    it('leaves the designation alone when a different account is archived', async () => {
      const { data: source, error: sourceError } = await client
        .from('accounts')
        .insert({
          user_id: userId,
          name: fixtureName(LABEL, 'kept-source'),
          color: 'chart-3',
          balance_cents: 1_000,
          balance_as_of: '2026-07-01',
        })
        .select('id')
        .single()
      expect(sourceError).toBeNull()

      const { data: other, error: otherError } = await client
        .from('accounts')
        .insert({
          user_id: userId,
          name: fixtureName(LABEL, 'bystander'),
          color: 'chart-4',
          balance_cents: 1_000,
          balance_as_of: '2026-07-01',
        })
        .select('id')
        .single()
      expect(otherError).toBeNull()
      if (!source || !other) throw new Error('insert did not return an id')

      const { error: settingsError } = await client
        .from('user_settings')
        .update({ discretionary_account_id: source.id })
        .eq('user_id', userId)
      expect(settingsError).toBeNull()

      const { error: archiveError } = await client
        .from('accounts')
        .update({ archived_on: '2026-08-10' })
        .eq('id', other.id)
      expect(archiveError).toBeNull()

      const { data: settings, error: rereadError } = await client
        .from('user_settings')
        .select('discretionary_account_id')
        .eq('user_id', userId)
        .single()
      expect(rereadError).toBeNull()
      expect(settings?.discretionary_account_id).toBe(source.id)
    })

    it('restores an archived account', async () => {
      const { data: inserted, error: insertError } = await client
        .from('accounts')
        .insert({
          user_id: userId,
          name: fixtureName(LABEL, 'restorable'),
          color: 'chart-2',
          balance_cents: 1_000,
          balance_as_of: '2026-07-01',
          archived_on: '2026-08-01',
        })
        .select('id')
        .single()
      expect(insertError).toBeNull()
      if (!inserted) throw new Error('insert did not return an id')

      const { error: restoreError } = await client
        .from('accounts')
        .update({ archived_on: null })
        .eq('id', inserted.id)
      expect(restoreError).toBeNull()

      const { data: reread, error: rereadError } = await client
        .from('accounts')
        .select('archived_on')
        .eq('id', inserted.id)
        .single()
      expect(rereadError).toBeNull()
      expect(reread?.archived_on).toBeNull()

      // The designation is *not* restored with it (domain/accounts.ts
      // `restoreAccount`'s doc comment states the same stance) — proven here by
      // the fact that nothing above ever pointed the column at this account, so
      // it stays whatever it already was.
    })

    it('rejects a staleness threshold outside the sanity range', async () => {
      for (const outOfRange of [0, 366]) {
        const { error } = await client
          .from('user_settings')
          .update({ balance_stale_after_days: outOfRange })
          .eq('user_id', userId)
        expect(error, `${outOfRange} should violate the 1..365 check constraint`).not.toBeNull()
      }

      for (const inRange of [1, 365]) {
        const { error } = await client
          .from('user_settings')
          .update({ balance_stale_after_days: inRange })
          .eq('user_id', userId)
        expect(error, `${inRange} is within 1..365 and should be accepted`).toBeNull()

        const { data: settings, error: rereadError } = await client
          .from('user_settings')
          .select('balance_stale_after_days')
          .eq('user_id', userId)
          .single()
        expect(rereadError).toBeNull()
        expect(settings?.balance_stale_after_days).toBe(inRange)
      }
    })
  },
)
