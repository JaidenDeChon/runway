/**
 * AC10's second half: the horizon top-up fires on loading the authenticated
 * shell, for a rule that came from *outside* the app entirely.
 *
 * `tests/integration/occurrence-regeneration.test.ts` and
 * `tests/rls/occurrence-regeneration.test.ts` both call the RPC directly and
 * would stay green even if `useOccurrenceMaterialization`'s
 * `startHorizonUpkeep` never ran in the browser at all — this file exists
 * specifically to catch that failure mode. The rule below is planted with a
 * raw `INSERT`, the same way a row created by a future import feature or a
 * support script would arrive: never through `useRunwayData`, so nothing
 * this test observes could be explained by `saveRecurringItem`'s own
 * regeneration call (`tests/e2e/recurring-items.spec.ts`'s AC10 test proves
 * that half instead).
 *
 * Runs on `emptyHouseholdPage` (user D), matching `recurring-items.spec.ts`.
 * The planting happens *inside* the test, after the fixture has resolved —
 * `emptyHouseholdSession`'s own setup wipes D's household before handing
 * back a session, so planting any earlier would be wiped before the test
 * ever navigated.
 */

import { adminSql, USER_D } from '../support/database'
import { expect, gotoHydrated, test } from './fixtures'

const PLANTED_ACCOUNT_NAME = 'E2E Materialization Horizon Checking'
const PLANTED_RULE_NAME = 'E2E Materialization Horizon Rent'

async function plantRuleOutsideTheApp(): Promise<void> {
  const sql = adminSql()
  try {
    const [account] = await sql<{ id: string }[]>`
      insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
      values (${USER_D.id}, ${PLANTED_ACCOUNT_NAME}, 'chart-2', 100_000, '2026-08-15')
      returning id
    `
    if (!account) throw new Error('could not plant the probe account')

    // A rule with occurrence rows in exactly zero places to start. The point
    // of this file is to prove something other than the create-a-rule flow
    // is what makes rows appear for it.
    await sql`
      insert into public.recurring_rules
        (user_id, account_id, name, kind, amount_cents, cadence, anchor_date)
      values
        (${USER_D.id}, ${account.id}, ${PLANTED_RULE_NAME}, 'bill', 5_000, 'monthly', '2026-08-20')
    `
  } finally {
    await sql.end()
  }
}

async function occurrenceDatesFor(ruleName: string): Promise<string[]> {
  const sql = adminSql()
  try {
    const rows = await sql<{ projected_date: string }[]>`
      select o.projected_date::text as projected_date
        from public.occurrences o
        join public.recurring_rules r on r.id = o.rule_id
       where r.name = ${ruleName}
       order by o.projected_date
    `
    return rows.map((row) => row.projected_date)
  } finally {
    await sql.end()
  }
}

test.describe('the horizon top-up', () => {
  test('AC10: loading the authenticated shell materializes a rule the app never wrote', async ({
    emptyHouseholdPage: page,
  }) => {
    await plantRuleOutsideTheApp()

    // Guard: no occurrence exists for the planted rule before the page is
    // ever loaded, so what follows cannot be explained by anything but the
    // load below.
    expect(await occurrenceDatesFor(PLANTED_RULE_NAME)).toEqual([])

    await gotoHydrated(page, '/')

    // `default.vue`'s `startHorizonUpkeep` installs a watcher in `onMounted`
    // and runs once the household has loaded — polled because that is
    // reactive, not synchronous with the navigation above.
    let dates: string[] = []
    await expect
      .poll(
        async () => {
          dates = await occurrenceDatesFor(PLANTED_RULE_NAME)
          return dates.length
        },
        { message: 'expected the horizon top-up to materialize the planted rule' },
      )
      .toBeGreaterThan(0)

    expect(dates).toContain('2026-08-20')
  })
})
