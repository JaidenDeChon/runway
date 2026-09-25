/**
 * Income prediction from history, end to end — issue #18.
 *
 * The acceptance criteria this covers: "E2E test confirms an estimate appears
 * once history exists", and the Definition of Done's "E2E test covers
 * estimate display and override".
 *
 * Runs on `emptyHouseholdPage` (user D), for the reason every write-flow spec
 * gives: it writes real rows, and A and C are held to exact figures by
 * `tests/rls/seed-fidelity.test.ts` and `dashboard-states.spec.ts`.
 *
 * **Where the history comes from.** Nothing in the app creates a settled
 * (`status = 'confirmed'`) occurrence yet — that is reconciliation, issue #26
 * — so this spec settles two past paychecks through D's *own* Supabase
 * session, never the admin connection (CLAUDE.md: "Seed fixtures go in
 * through a user's own session"). That is the same INSERT policy the app
 * would use, and it is the only part of this spec that does not go through
 * the UI. `resetEmptyHousehold` deletes D's accounts afterwards, and the
 * cascade takes the rule and every occurrence with it.
 */

import { signedInClient, USER_D } from '../support/database'
import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

/** `2026-09-05` → `Sep 5`, matching `app/lib/format.ts`'s `formatDateShort` exactly. */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

/** Today, or `days` from it, as `YYYY-MM-DD` — never a literal date. See occurrence-editor.spec.ts. */
function isoDaysFromToday(days: number): string {
  const MS_PER_DAY = 86_400_000
  const todayUtcMidnight = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY
  return new Date(todayUtcMidnight + days * MS_PER_DAY).toISOString().slice(0, 10)
}

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

async function createAccount(
  page: import('@playwright/test').Page,
  name: string,
  balance: string,
): Promise<void> {
  await gotoHydrated(page, '/accounts')
  const dialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)
  await page.locator('#account-name').fill(name)
  await page.locator('#account-balance').fill(balance)
  const row = page.getByRole('button', { name: `Edit ${name}` })
  await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
  await expect(row).toBeVisible()
}

/**
 * Creates a monthly income item set to "Predict from deposits" before any
 * deposit has settled — the state #18 makes reachable, where the typed amount
 * is the one in use and the form says so.
 */
async function createPredictedIncome(
  page: import('@playwright/test').Page,
  name: string,
  fallback: string,
  firstDate: string,
): Promise<void> {
  await gotoHydrated(page, '/recurring-items')
  const dialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('button', { name: 'Add recurring item' }), dialog)
  await dialog.getByRole('tab', { name: 'Income' }).click()
  await page.locator('#recurring-name').fill(name)
  await dialog.getByText('Predict from deposits').click()
  await expect(dialog.getByText(/Not enough deposit history yet/)).toBeVisible()
  await page.locator('#recurring-amount').fill(fallback)
  await page.locator('#recurring-next-occurrence').fill(firstDate)
  const row = page.getByRole('button', { name: `Edit ${name}` })
  await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)
  await expect(row).toBeVisible()
}

/** Settles past occurrences of D's rule `ruleName` through D's own session. */
async function settleForUserD(
  ruleName: string,
  settled: readonly { readonly date: string; readonly cents: number }[],
): Promise<void> {
  const client = await signedInClient(USER_D)
  const { data: rule, error: ruleError } = await client
    .from('recurring_rules')
    .select('id, account_id')
    .eq('name', ruleName)
    .single()
  if (ruleError || !rule) throw new Error(`could not find D's rule: ${ruleError?.message}`)
  const { error } = await client.from('occurrences').insert(
    settled.map((row) => ({
      user_id: USER_D.id,
      account_id: rule.account_id,
      rule_id: rule.id,
      projected_date: row.date,
      projected_amount_cents: row.cents,
      actual_amount_cents: row.cents,
      status: 'confirmed' as const,
    })),
  )
  if (error) throw new Error(`could not settle D's occurrences: ${error.message}`)
  // Local scope: a global sign-out would revoke the browser's session for D too.
  await client.auth.signOut({ scope: 'local' })
}

test.describe('income prediction from history', () => {
  test('an estimate appears once history exists, and an override replaces it for good', async ({
    emptyHouseholdPage: page,
  }) => {
    const name = 'E2E Predicted Paycheck'
    await createAccount(page, 'E2E Predict Checking', '1000')
    const payday = isoDaysFromToday(6)
    await createPredictedIncome(page, name, '2000', payday)

    // Before any history: the fallback amount is in use, and it is still
    // marked — a figure the user said to predict is not a certainty.
    const row = page.getByRole('button', { name: `Edit ${name}` })
    await expect(row).toContainText('+$2,000')
    await expect(row).toContainText('Predicted')

    await gotoHydrated(page, '/')
    await expect(
      page.getByRole('button', { name: new RegExp(`${name}.*Estimated amount`) }),
    ).toBeVisible()

    // History lands: two settled paychecks, $2,400 and $2,500.
    await settleForUserD(name, [
      { date: isoDaysFromToday(-60), cents: 240_000 },
      { date: isoDaysFromToday(-30), cents: 250_000 },
    ])

    // The estimate — their mean — replaces the fallback everywhere, without
    // anybody re-saving the item.
    await gotoHydrated(page, '/recurring-items')
    await expect(row).toContainText('+$2,450')
    await row.click()
    const editor = page.getByRole('dialog')
    await expect(editor.getByText('predicted', { exact: true })).toBeVisible()
    await expect(editor.getByText(/Predicted from your last 2 deposits/)).toBeVisible()
    await editor.getByRole('button', { name: 'Cancel' }).click()

    await gotoHydrated(page, '/')
    await page.locator(`[data-day="${payday}"]`).click()
    const day = page.getByRole('dialog')
    const occurrence = day.getByRole('button', { name: new RegExp(name) })
    await expect(occurrence).toContainText('$2,450')
    await expect(occurrence).toContainText('Estimated amount')

    // The override: the user states this one paycheck's amount.
    await occurrence.click()
    await day.locator('#occurrence-amount').fill('2600')
    await day.getByRole('button', { name: 'Save change' }).click()
    await expect(day.getByText('Edited')).toBeVisible({ timeout: 10_000 })
    await day.getByRole('button', { name: 'Done' }).click()

    // …and it stays overridden across a reload: the edited figure, marked as
    // an edit and no longer as an estimate — the estimate is not recomputed
    // over the user's own number.
    await gotoHydrated(page, '/')
    await page.locator(`[data-day="${payday}"]`).click()
    const reopened = page.getByRole('dialog').getByRole('button', { name: new RegExp(name) })
    await expect(reopened).toContainText('$2,600')
    await expect(reopened).toContainText('Edited')
    await expect(reopened).not.toContainText('Estimated amount')
  })

  test('a variable bill is marked as an estimate before any history, and shows the date it lands', async ({
    emptyHouseholdPage: page,
  }) => {
    const name = 'E2E Variable Utilities'
    await createAccount(page, 'E2E Variable Checking', '1000')
    const dueDate = isoDaysFromToday(5)

    await gotoHydrated(page, '/recurring-items')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add recurring item' }), dialog)
    await page.locator('#recurring-name').fill(name)
    await page.locator('#recurring-amount').fill('120')
    await page.locator('#recurring-next-occurrence').fill(dueDate)
    await dialog.getByRole('checkbox', { name: 'Amount varies each cycle' }).click()
    const row = page.getByRole('button', { name: `Edit ${name}` })
    await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)
    await expect(row).toContainText('Est.')

    await gotoHydrated(page, '/')
    const upcoming = page.getByRole('button', { name: new RegExp(`${name}.*Estimated amount`) })
    await expect(upcoming).toBeVisible()
    await expect(upcoming).toContainText(shortDate(dueDate))
  })
})
