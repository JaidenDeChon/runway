/**
 * Acceptance criteria: full CRUD on `recurring_rules` persists under the
 * owner's own session, `ends_on` round-trips (AC5's storage half), and a rule
 * can never reference another user's account — enforced at the data layer,
 * not the form (AC8/AC10).
 *
 * Runs under **user B's own session** (`secondUserContext()`), for the same
 * reason `tests/integration/accounts-crud.test.ts` does: A and C are
 * `tests/rls/seed-fidelity.test.ts`'s exact-list fixtures, and a fixture row
 * planted there — even one cleaned up afterward — is a length assertion
 * waiting to flake if teardown ever fails mid-suite. B mirrors nothing.
 *
 * The cross-user probe (AC10) is the one place this file reaches for user
 * A — as the *attempting* session, never as the household written to. The
 * insert it attempts is rejected before a row ever lands, so it cannot
 * disturb A's seeded household or `seed-fidelity`'s exact-list assertion.
 *
 * Rows are named with the `fixture:recurring-rules-crud:` prefix and swept
 * by `removeFixtures` in both `beforeAll` and `afterAll`, matching
 * `accounts-crud.test.ts`'s shape.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AuthContext, secondUserContext, validUserContext } from '../support/auth'
import { LOCAL_STACK } from '../support/database'
import { fixtureName, removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'recurring-rules-crud'

describe.skipIf(LOCAL_STACK === null)(
  'recurring rules CRUD, the ends_on window and cross-user account references',
  () => {
    let context: AuthContext
    let userId: string
    let client: AuthContext['client']
    let accountId: string

    beforeAll(async () => {
      await removeFixtures(LABEL)
      context = await secondUserContext()
      if (!context.userId) throw new Error('second-user context has no user id')
      userId = context.userId
      client = context.client

      const household = await seedHousehold(context, {
        label: LABEL,
        accounts: [
          {
            id: 'acct-primary',
            name: 'Primary',
            balance: 10_000,
            balanceAsOf: '2026-08-01',
            color: 'chart-2',
            isDiscretionarySource: false,
          },
        ],
      })
      const id = household.accountIds.get('acct-primary')
      if (!id) throw new Error('the fixture account did not come back from seedHousehold')
      accountId = id
    })

    afterAll(async () => {
      if (!LOCAL_STACK) return
      await removeFixtures(LABEL)
    })

    it('inserts, updates and deletes a rule under the owning session', async () => {
      const { data: inserted, error: insertError } = await client
        .from('recurring_rules')
        .insert({
          user_id: userId,
          account_id: accountId,
          name: fixtureName(LABEL, 'round-trip'),
          kind: 'bill',
          amount_cents: 5_000,
          cadence: 'monthly',
          anchor_date: '2026-09-01',
        })
        .select('id, amount_cents')
        .single()
      expect(insertError).toBeNull()
      expect(inserted?.amount_cents).toBe(5_000)
      if (!inserted) throw new Error('insert did not return a row')

      const { error: updateError } = await client
        .from('recurring_rules')
        .update({ amount_cents: 6_000 })
        .eq('id', inserted.id)
      expect(updateError).toBeNull()

      const { data: reread, error: rereadError } = await client
        .from('recurring_rules')
        .select('amount_cents')
        .eq('id', inserted.id)
        .single()
      expect(rereadError).toBeNull()
      expect(reread?.amount_cents).toBe(6_000)

      const { error: deleteError } = await client
        .from('recurring_rules')
        .delete()
        .eq('id', inserted.id)
      expect(deleteError).toBeNull()

      const { data: goneCheck, error: goneError } = await client
        .from('recurring_rules')
        .select('id')
        .eq('id', inserted.id)
      expect(goneError).toBeNull()
      expect(goneCheck ?? []).toHaveLength(0)
    })

    it('round-trips ends_on — ending a rule is a stored window, not a delete', async () => {
      const { data: inserted, error } = await client
        .from('recurring_rules')
        .insert({
          user_id: userId,
          account_id: accountId,
          name: fixtureName(LABEL, 'ends-on'),
          kind: 'bill',
          amount_cents: 1_000,
          cadence: 'monthly',
          anchor_date: '2026-01-01',
          ends_on: '2026-08-31',
        })
        .select('ends_on')
        .single()
      expect(error).toBeNull()
      expect(inserted?.ends_on).toBe('2026-08-31')
    })

    it('rejects ends_on before starts_on', async () => {
      const { error } = await client.from('recurring_rules').insert({
        user_id: userId,
        account_id: accountId,
        name: fixtureName(LABEL, 'inverted-window'),
        kind: 'bill',
        amount_cents: 1_000,
        cadence: 'monthly',
        anchor_date: '2026-09-01',
        starts_on: '2026-09-01',
        ends_on: '2026-08-01',
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514') // recurring_rules_window_ck
    })

    it('rejects amount_cents <= 0', async () => {
      const { error } = await client.from('recurring_rules').insert({
        user_id: userId,
        account_id: accountId,
        name: fixtureName(LABEL, 'non-positive-amount'),
        kind: 'bill',
        amount_cents: 0,
        cadence: 'monthly',
        anchor_date: '2026-09-01',
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514')
    })

    it('rejects is_variable on income', async () => {
      const { error } = await client.from('recurring_rules').insert({
        user_id: userId,
        account_id: accountId,
        name: fixtureName(LABEL, 'variable-income'),
        kind: 'income',
        amount_cents: 1_000,
        cadence: 'monthly',
        anchor_date: '2026-09-01',
        is_variable: true,
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514') // recurring_rules_variable_is_bill_ck
    })

    it('rejects amount_source: predicted on a bill', async () => {
      const { error } = await client.from('recurring_rules').insert({
        user_id: userId,
        account_id: accountId,
        name: fixtureName(LABEL, 'predicted-bill'),
        kind: 'bill',
        amount_cents: 1_000,
        amount_source: 'predicted',
        cadence: 'monthly',
        anchor_date: '2026-09-01',
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23514') // recurring_rules_predicted_is_income_ck
    })

    it('normalises a day set on write: [15, 1, 15] is read back as [1, 15]', async () => {
      const { data: inserted, error } = await client
        .from('recurring_rules')
        .insert({
          user_id: userId,
          account_id: accountId,
          name: fixtureName(LABEL, 'day-set-normalization'),
          kind: 'income',
          amount_cents: 2_000,
          cadence: 'monthly',
          anchor_date: '2026-09-01',
          days_of_month: [15, 1, 15],
        })
        .select('days_of_month')
        .single()
      expect(error).toBeNull()
      expect(inserted?.days_of_month).toEqual([1, 15])
    })

    // AC10, the headline test: even a caller whose session passes the RLS
    // WITH CHECK (the row's own user_id is theirs) is stopped by the
    // composite FK the moment the account named belongs to somebody else —
    // this is what makes "the owning account must belong to the same user" a
    // data-layer guarantee, not merely a policy one. Asserted on the error
    // *code*, never a message that could carry data.
    it("rejects a rule whose account belongs to another user, as a foreign-key violation, through the attacker's own session", async () => {
      const attacker = await validUserContext()
      if (!attacker.userId) throw new Error('valid-user context has no user id')

      const { error } = await attacker.client.from('recurring_rules').insert({
        user_id: attacker.userId,
        account_id: accountId, // belongs to user B, not the attacker
        name: fixtureName(LABEL, 'cross-user-probe'),
        kind: 'bill',
        amount_cents: 100,
        cadence: 'monthly',
        anchor_date: '2026-09-01',
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23503') // foreign_key_violation: recurring_rules_account_fk
    })
  },
)
