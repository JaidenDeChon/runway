/**
 * "Will I make it?"'s two empty states, end to end.
 *
 * `useRunwayData` returns zero accounts for a new user, and issue #7 stopped
 * seeding recurring items, so with no guard `shortfallThrough` ran on an
 * empty household and confidently answered "Covered" from a $0 balance — a
 * positive verdict computed from nothing, on the one page whose entire job is
 * answering that question truthfully.
 *
 * Two distinct states, not one:
 *
 * - **No accounts** — no starting balance, so neither mode has an honest
 *   answer. The verdict card is suppressed entirely.
 * - **Accounts but no recurring items** — date mode still works (a
 *   projection from balances alone is meaningful), but bill mode has nothing
 *   to point at, so its tab is disabled and date mode is the default. This is
 *   spec.md's Open Question 7's own scenario, and there is no
 *   `screens/empty.png` for either state — a deviation raised in the PR
 *   rather than resolved silently.
 *
 * Both run on `emptyHouseholdPage` (user D): the first needs the empty
 * household as-is, and the second needs to add exactly one account without
 * touching a seeded user's household — the same reasoning
 * tests/e2e/accounts.spec.ts's write-path tests give for using D instead of A.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('no accounts', () => {
  test('suppresses the verdict instead of answering from nothing', async ({
    emptyHouseholdPage: page,
  }) => {
    await gotoHydrated(page, '/will-i-make-it')

    await expect(page.getByRole('heading', { name: 'Nothing to check yet' })).toBeVisible()
    const link = page.getByRole('link', { name: /Add an account/ })
    await expect(link).toBeVisible()

    // Neither verdict, anywhere on the page — not "Covered" computed from a
    // $0 balance, and not "Short" either.
    await expect(page.getByText('Covered', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Short', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Today', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Lowest point', { exact: true })).toHaveCount(0)

    // Neither ask card either — there is nothing honest to ask about with no
    // starting balance.
    await expect(page.getByRole('tab', { name: 'Upcoming bill' })).toHaveCount(0)

    await link.click()
    await expect(page).toHaveURL(/\/accounts/)
  })
})

test.describe('accounts but no recurring items', () => {
  test('disables bill mode, defaults to date mode, and still answers honestly', async ({
    emptyHouseholdPage: page,
  }) => {
    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)
    await page.locator('#account-name').fill('E2E Shortfall Checking')
    await page.locator('#account-balance').fill('2000')
    const row = page.getByRole('button', { name: 'Edit E2E Shortfall Checking' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
    await expect(row).toBeVisible()

    await gotoHydrated(page, '/will-i-make-it')

    // A real, honest verdict — a projection from balances alone is
    // meaningful, so this is not suppressed the way the no-accounts state is.
    await expect(page.getByText('Today', { exact: true })).toBeVisible()
    await expect(page.getByText('Lowest point', { exact: true })).toBeVisible()

    // Bill mode has nothing to point at with no recurring items, so it is
    // disabled — never removed, per the spec's own "hide or disable" wording
    // — and date mode is what actually renders.
    const billTab = page.getByRole('tab', { name: 'Upcoming bill' })
    await expect(billTab).toBeVisible()
    await expect(billTab).toBeDisabled()
    await expect(page.locator('#shortfall-date')).toBeVisible()

    // The way out, not a dead end.
    const recurringLink = page.getByRole('link', { name: /Add a recurring item/ })
    await expect(recurringLink).toBeVisible()
    await recurringLink.click()
    await expect(page).toHaveURL(/\/recurring-items/)
  })
})
