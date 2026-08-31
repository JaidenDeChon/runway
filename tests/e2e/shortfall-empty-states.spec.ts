/**
 * "Will I make it?"'s two unanswerable states, end to end.
 *
 * The page is the one screen whose entire job is answering a question
 * truthfully, and `shortfallThrough` will answer whatever it is asked. Given
 * an empty household it projects a flat $0 line, finds a low point of $0,
 * compares it to a $0 cushion and reports **Covered** — arithmetically correct
 * and the most misleading thing this app could say. `canAnswerShortfall`
 * (domain/projection.ts) is the rule that decides when there is enough to
 * answer at all; these tests are that rule seen from the browser.
 *
 * Two states share one card, because from the user's side they are one
 * problem with two different missing pieces:
 *
 * - **No accounts** — no balance to project from.
 * - **Accounts but nothing that spends them** — a balance, and nothing coming
 *   for it. This is the state a user reaches by finishing onboarding with a
 *   single account, and the one that used to render a green "Covered".
 *
 * Then the third test, which is the point of the other two: add one bill and
 * the verdict appears. A gate that never opens is just a broken screen.
 *
 * `spec.md` Open Question 7 covers only the no-bills case, only as far as the
 * *tab* ("hide or disable"), and there is no `screens/empty.png` for either
 * state — the copy asserted here is invented, a deviation raised in the PR
 * rather than resolved silently.
 *
 * All three run on `emptyHouseholdPage` (user D): they need a household they
 * can add to without accumulating rows that
 * `tests/rls/seed-fidelity.test.ts`'s exact-list assertion would then fail on.
 * See `tests/e2e/fixtures.ts`.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

/** Adds one account through the real UI, the way a user would. */
async function addAccount(
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

/** Neither verdict, nowhere on the page — not "Covered", and not "Short" either. */
async function expectNoVerdict(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByText('Covered', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Short', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Today', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Lowest point', { exact: true })).toHaveCount(0)
  // Nor anything to ask with — there is nothing honest to ask about.
  await expect(page.getByRole('tab', { name: 'Upcoming bill' })).toHaveCount(0)
}

test.describe('no accounts', () => {
  test('suppresses the verdict instead of answering from nothing', async ({
    emptyHouseholdPage: page,
  }) => {
    await gotoHydrated(page, '/will-i-make-it')

    await expect(page.getByRole('heading', { name: 'Nothing to check yet' })).toBeVisible()
    await expectNoVerdict(page)

    const link = page.getByRole('link', { name: /Add an account/ })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/accounts/)
  })
})

test.describe('an account, but nothing spending it', () => {
  test('refuses to call a $0 household "Covered"', async ({ emptyHouseholdPage: page }) => {
    // $0 exactly: the balance from which the old behaviour computed a green
    // verdict against a $0 cushion. Nothing about that answer was wrong except
    // that it meant nothing.
    await addAccount(page, 'E2E Shortfall Checking', '0')

    await gotoHydrated(page, '/will-i-make-it')

    await expect(page.getByRole('heading', { name: 'Not enough to go on yet' })).toBeVisible()
    await expectNoVerdict(page)

    const link = page.getByRole('link', { name: /Add a recurring item/ })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/recurring-items/)
  })

  test('refuses a funded account just the same — money is not information', async ({
    emptyHouseholdPage: page,
  }) => {
    // A healthy balance is the tempting case: "Covered" looks defensible here
    // and is the same empty answer, because nothing has been said about what
    // is coming.
    await addAccount(page, 'E2E Funded Checking', '5000')

    await gotoHydrated(page, '/will-i-make-it')

    await expect(page.getByRole('heading', { name: 'Not enough to go on yet' })).toBeVisible()
    await expectNoVerdict(page)
  })
})

test.describe('once there is a bill', () => {
  test('the gate opens and the page answers', async ({ emptyHouseholdPage: page }) => {
    await addAccount(page, 'E2E Gate Checking', '5000')

    await gotoHydrated(page, '/will-i-make-it')
    await expect(page.getByRole('heading', { name: 'Not enough to go on yet' })).toBeVisible()

    // Followed rather than `goto`-ed, and returned from with `goBack()`, for a
    // reason that is not stylistic: recurring items are still session-local
    // `useState` (issue #8 owns moving them onto Supabase), so a full page
    // load would drop the item this test is about to add and the gate would
    // correctly close again. Both hops here are client-side route changes —
    // which is also exactly the path the empty state's own call to action
    // invites a user down.
    await page.getByRole('link', { name: /Add a recurring item/ }).click()
    await expect(page).toHaveURL(/\/recurring-items/)

    const dialog = page.getByRole('dialog')
    const addTrigger = page
      .getByRole('button', { name: 'Add recurring item' })
      .filter({ visible: true })
      .first()
    await clickUntil(addTrigger, dialog)
    await dialog.locator('#recurring-name').fill('E2E Rent')
    await dialog.locator('#recurring-amount').fill('1200')
    const itemRow = page.getByText('E2E Rent', { exact: true })
    await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), itemRow)
    await expect(itemRow).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/will-i-make-it/)

    // A real verdict, on a real bill.
    await expect(page.getByText('Lowest point', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Upcoming bill' })).toBeEnabled()
    await expect(page.getByRole('heading', { name: 'Not enough to go on yet' })).toHaveCount(0)
  })
})
