/**
 * Negative control for `public.recent_settled_amounts()` (issue #18): which
 * policies actually keep one user's settled history out of another's
 * estimate.
 *
 * The function is `security invoker` with no user parameter, so RLS is the
 * only thing scoping it — but *two* tables' RLS, not one: since
 * `20260924030000_recent_settled_amounts_bounds.sql` it joins
 * `public.recurring_rules` (`r.id = o.rule_id and r.user_id = o.user_id`), so
 * `recurring_rules_select_own` filters another user's rows out at the join
 * even if `occurrences_select_own` did not. A hand-run negative control on
 * the PR that introduced the join found exactly that — loosening the
 * occurrences policy alone left the isolation test green — and left the
 * third case (the rules policy alone) untried. This file makes all three
 * cases a recorded, repeatable property instead of a one-off:
 *
 * 1. either policy alone still isolates — the function has two barriers, and
 *    losing one is not a leak;
 * 2. losing both is a leak, and the check below sees it — so the check is not
 *    blind, and the two barriers are the *only* two.
 *
 * Same technique as `tests/rls/negative-control.test.ts`: an extra,
 * permissive `for select ... using (true)` policy is *added* (policies are
 * OR'd), never an existing one edited, and `afterAll` drops it whatever
 * happened. That file's note applies here too: this mutates shared database
 * state, which is why the integration project runs files one at a time
 * (`vitest.config.ts`). Rows go in through each user's own session; the
 * admin connection only ever touches policies.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toMinorUnits } from '~~/domain/money'
import type { RecurringItem } from '~~/domain/types'
import { type AuthContext, secondUserContext, validUserContext } from '../support/auth'
import { adminSql, LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'settled-history-negative-control'
const TODAY = '2026-09-03'

const LOOSE = {
  occurrences: 'occurrences_settled_history_negative_control',
  recurring_rules: 'recurring_rules_settled_history_negative_control',
} as const

type Table = keyof typeof LOOSE

async function loosen(table: Table): Promise<void> {
  const sql = adminSql()
  try {
    await sql.unsafe(
      `create policy ${LOOSE[table]} on public.${table} for select to authenticated using (true)`,
    )
  } finally {
    await sql.end()
  }
}

async function restore(table: Table): Promise<void> {
  const sql = adminSql()
  try {
    await sql.unsafe(`drop policy if exists ${LOOSE[table]} on public.${table}`)
  } finally {
    await sql.end()
  }
}

async function restoreAll(): Promise<void> {
  await restore('occurrences')
  await restore('recurring_rules')
}

const paycheck = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'pay',
  name: 'Paycheck',
  kind: 'income',
  amount: toMinorUnits(2_000),
  cadence: 'biweekly',
  accountId: 'a',
  nextOccurrence: '2026-06-05',
  amountSource: 'predicted',
  depositHistory: [],
  isVariable: false,
  ...over,
})

/** Seeds one predicted paycheck with two settled rows, through the owner's own session. */
async function seedSettled(context: AuthContext, name: string): Promise<string> {
  const household = await seedHousehold(context, {
    label: LABEL,
    accounts: [
      {
        id: 'a',
        name: `${name} checking`,
        balance: toMinorUnits(1_000),
        balanceAsOf: TODAY,
        color: 'chart-2',
        isDiscretionarySource: false,
      },
    ],
    recurringItems: [paycheck({ name })],
  })
  const accountId = household.accountIds.get('a') as string
  const ruleId = household.ruleIds.get('pay') as string
  const { error } = await context.client.from('occurrences').insert(
    ['2026-07-03', '2026-07-17'].map((date) => ({
      user_id: context.userId as string,
      account_id: accountId,
      rule_id: ruleId,
      projected_date: date,
      projected_amount_cents: toMinorUnits(2_000),
      actual_amount_cents: toMinorUnits(2_000),
      status: 'confirmed' as const,
    })),
  )
  if (error) throw new Error(`could not settle the probe rows (code ${error.code})`)
  return ruleId
}

/** How many of `foreignRuleId`'s rows `context` receives from the function. Ids and counts only. */
async function foreignRowsSeen(context: AuthContext, foreignRuleId: string): Promise<number> {
  const { data, error } = await context.client.rpc('recent_settled_amounts')
  if (error) throw new Error(`recent_settled_amounts failed (code ${error.code})`)
  return (data ?? []).filter((row) => row.rule_id === foreignRuleId).length
}

describe.skipIf(LOCAL_STACK === null)('recent_settled_amounts() negative control', () => {
  let userA: AuthContext
  let userB: AuthContext
  let ruleA: string
  let ruleB: string

  beforeAll(async () => {
    await restoreAll()
    await removeFixtures(LABEL)
    userA = await validUserContext()
    userB = await secondUserContext()
    ruleA = await seedSettled(userA, 'Negative control A')
    ruleB = await seedSettled(userB, 'Negative control B')
  })

  // Runs even if an assertion threw mid-test: a loose policy left behind
  // would silently disarm every isolation test that runs after this file.
  afterAll(async () => {
    if (!LOCAL_STACK) return
    await restoreAll()
    await removeFixtures(LABEL)
  })

  it('isolates under the real policies — the baseline the other cases move from', async () => {
    expect(await foreignRowsSeen(userB, ruleA)).toBe(0)
    expect(await foreignRowsSeen(userA, ruleB)).toBe(0)
    // Not vacuous: each user does see their own two rows.
    expect(await foreignRowsSeen(userB, ruleB)).toBe(2)
  })

  it('still isolates with occurrences_select_own opened — recurring_rules_select_own holds at the join', async () => {
    await loosen('occurrences')
    try {
      expect(await foreignRowsSeen(userB, ruleA)).toBe(0)
    } finally {
      await restore('occurrences')
    }
  })

  it('still isolates with recurring_rules_select_own opened — occurrences_select_own holds on the rows', async () => {
    await loosen('recurring_rules')
    try {
      expect(await foreignRowsSeen(userB, ruleA)).toBe(0)
    } finally {
      await restore('recurring_rules')
    }
  })

  it('leaks with both opened — so the check sees a leak, and these are the only two barriers', async () => {
    await loosen('occurrences')
    await loosen('recurring_rules')
    try {
      expect(await foreignRowsSeen(userB, ruleA)).toBe(2)
    } finally {
      await restoreAll()
    }
    // And the restore took.
    expect(await foreignRowsSeen(userB, ruleA)).toBe(0)
  })
})
