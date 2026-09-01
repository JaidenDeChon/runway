/**
 * Recurring items, end to end — issue #8's real proof.
 *
 * Every test here runs on `emptyHouseholdPage` (user D): each one writes real
 * rows, and running them as user A would add accounts and rules to A's
 * household that `tests/rls/seed-fidelity.test.ts`'s exact-list assertion
 * would then fail on. See `tests/e2e/fixtures.ts` and
 * `tests/e2e/accounts.spec.ts`, whose fixture idiom this follows.
 *
 * AC11 is the headline test: a bill actually moving the dashboard's chart on
 * the day it's due is the acceptance criterion, not merely that a row appears
 * in a list — the old in-memory implementation could pass the latter and
 * never reach a real projection. AC1 (persistence) and AC5 (ending a rule) are
 * the other two assertions the old implementation could not have passed.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

/** U+2212, the typographic minus the app renders — see negative-balances.spec.ts. */
const MINUS = '−'

/** `2026-09-05` → `Sep 5`, matching `app/lib/format.ts`'s `formatDateShort` exactly. */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

/** Today, or `daysAhead`/`daysBehind` from it, as `YYYY-MM-DD` — never a literal date, so this never goes stale. */
function isoDaysFromToday(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

/** Creates an account through the UI — every test here needs one to hang a rule off. */
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

test.describe('creating a bill', () => {
  test('AC11: a bill on a known date drops the projected balance on that date', async ({
    emptyHouseholdPage: page,
  }) => {
    await createAccount(page, 'E2E Runway Checking', '500')

    // $700 due in 6 days against a $500 balance: a deterministic, negative
    // low point, which is also the strongest version of "the chart reflects
    // the rule" — not just a dip, but the specific figure and date.
    const dueDate = isoDaysFromToday(6)
    await gotoHydrated(page, '/recurring-items')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add recurring item' }), dialog)
    await page.locator('#recurring-name').fill('E2E Rent')
    await page.locator('#recurring-amount').fill('700')
    await page.locator('#recurring-next-occurrence').fill(dueDate)
    const row = page.getByRole('button', { name: 'Edit E2E Rent' })
    await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)
    await expect(row).toBeVisible()

    await gotoHydrated(page, '/')

    // The chart's own accessible summary states the lowest projected balance
    // and the date it falls on — see BurndownChart.vue's `summary`. This is
    // the actual acceptance criterion: the rule reaching a real projection,
    // not merely a row existing in a list.
    const chart = page.getByRole('img', { name: /Balance forecast/ })
    await expect(chart).toHaveAttribute(
      'aria-label',
      new RegExp(
        `Lowest projected balance ${MINUS}\\$200 on ${shortDate(dueDate)}.*balance goes negative`,
      ),
    )
  })
})

test.describe('persistence', () => {
  test('AC1: a recurring item survives a full reload', async ({ emptyHouseholdPage: page }) => {
    await createAccount(page, 'E2E Reload Checking', '1000')

    await gotoHydrated(page, '/recurring-items')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add recurring item' }), dialog)
    await page.locator('#recurring-name').fill('E2E Reload Rent')
    await page.locator('#recurring-amount').fill('50')
    const row = page.getByRole('button', { name: 'Edit E2E Reload Rent' })
    await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)

    // The one assertion an in-memory store could not pass — the create above
    // proves the write; this proves it survived leaving the page entirely.
    await gotoHydrated(page, '/recurring-items')
    await expect(page.getByRole('button', { name: 'Edit E2E Reload Rent' })).toBeVisible()
  })
})

test.describe('ending a rule', () => {
  test('AC5: an ended rule renders "Ended" and the marker survives a reload', async ({
    emptyHouseholdPage: page,
  }) => {
    await createAccount(page, 'E2E Ending Checking', '1000')

    await gotoHydrated(page, '/recurring-items')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add recurring item' }), dialog)
    await page.locator('#recurring-name').fill('E2E Ending Rent')
    await page.locator('#recurring-amount').fill('50')
    const row = page.getByRole('button', { name: 'Edit E2E Ending Rent' })
    await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)
    await expect(row).toContainText('next')
    await expect(row).not.toContainText('Ended')

    // Ending it: a last occurrence strictly before today means
    // nextOccurrenceOnOrAfter finds nothing from today forward.
    await clickUntil(row, dialog)
    await dialog.locator('#recurring-has-end').click()
    await dialog.locator('#recurring-ends-on').fill(isoDaysFromToday(-1))
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toHaveCount(0)

    await expect(row).toContainText('Ended')
    // Not signalled by colour alone — the accessible name says so too.
    await expect(page.getByRole('button', { name: 'Edit E2E Ending Rent, ended' })).toBeVisible()

    // AC5 is explicitly non-destructive: the row stays, editable, after reload.
    await gotoHydrated(page, '/recurring-items')
    await expect(row).toContainText('Ended')
  })
})
