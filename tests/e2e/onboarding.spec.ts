/**
 * A real user flow, driven end to end through the running application.
 *
 * First-run onboarding is the right flow to hold this harness up with: it is
 * the only one in the app that *creates* records rather than reading seeded
 * ones, it spans two steps with state that has to survive a Back, and it ends
 * by navigating into the dashboard. If routing, forms, validation, client-side
 * state or navigation break, this fails.
 *
 * It needs no database, which is deliberate and worth stating: the app does not
 * read one yet (see tests/e2e/fixtures.ts). Keeping the flow tests independent
 * of the stack means the harness has something real to prove on every machine,
 * rather than skipping everywhere and being mistaken for coverage.
 */

import type { Locator, Page } from '@playwright/test'
import { assertBaseUrlIsLocal, expect, test } from './fixtures'

/**
 * A card's title.
 *
 * Not `getByRole('heading')`, and that is worth writing down: `shadcn-vue`'s
 * `CardTitle` renders a plain `<div>`, so card titles carry no heading role and
 * are invisible to a screen reader's heading navigation. That is an
 * accessibility gap in the application rather than in this test — flagged in
 * the PR for a human, not silently worked around — but a test cannot assert a
 * role the markup does not have. The stable `data-slot` the primitive does emit
 * is what these locate on.
 */
function cardTitle(page: Page, text: string): Locator {
  return page.locator('[data-slot="card-title"]', { hasText: text })
}

/** One side of a segmented control (`ToggleGroupItem`), located by its slot. */
function segment(page: Page, text: string): Locator {
  return page.locator('[data-slot="toggle-group-item"]', { hasText: text })
}

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('first-run onboarding', () => {
  test('takes a new user from nothing to a projection', async ({ page }) => {
    await page.goto('/first-run')

    await expect(page.getByRole('heading', { name: 'See how far your money goes.' })).toBeVisible()

    // --- Step 1: the account ------------------------------------------------
    await expect(page.getByText('Step 1 of 2')).toBeVisible()

    const continueButton = page.getByRole('button', { name: 'Continue' })
    // The form gates itself until the account has a name, and says why.
    await expect(continueButton).toBeDisabled()
    await expect(page.getByText('Name your account to continue.')).toBeVisible()

    await page.locator('#onboarding-account-name').fill('Checking')
    await page.locator('#onboarding-account-balance').fill('2500')
    await expect(continueButton).toBeEnabled()
    await continueButton.click()

    // --- Step 2: the recurring item -----------------------------------------
    await expect(cardTitle(page, 'Add a bill or paycheck')).toBeVisible()

    const buildButton = page.getByRole('button', { name: 'Build my runway' })
    await expect(buildButton).toBeDisabled()

    await page.locator('#onboarding-item-name').fill('Rent')
    await page.locator('#onboarding-item-amount').fill('1200')
    await expect(buildButton).toBeEnabled()
    await buildButton.click()

    // --- Done ---------------------------------------------------------------
    await expect(cardTitle(page, "You're set.")).toBeVisible()

    // The summary is composed from what was actually saved, so it is the
    // cheapest proof that both records landed with the right values. Money is
    // asserted as the formatted string because formatting at the edge is the
    // rule the app is built on — a raw `1200` appearing here would be a bug.
    const summary = page.getByText(/We'll track Checking against Rent/)
    await expect(summary).toBeVisible()
    // Whole dollars: `formatMoney` defaults to `maximumFractionDigits: 0`,
    // because every figure in the design is shown to whole dollars.
    await expect(summary).toContainText('$1,200')

    // --- Into the app -------------------------------------------------------
    await page.getByRole('link', { name: 'See your runway' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page).toHaveTitle(/Home/)
  })

  test('keeps the step-one account name when the user goes back', async ({ page }) => {
    await page.goto('/first-run')

    await page.locator('#onboarding-account-name').fill('Everyday')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(cardTitle(page, 'Add a bill or paycheck')).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()

    // The step components unmount and remount; the form state lives above them
    // precisely so this round trip is lossless.
    await expect(page.locator('#onboarding-account-name')).toHaveValue('Everyday')
  })

  /**
   * A real defect, found by this harness on its first run against the branch.
   *
   * The balance typed in step 1 never reaches `accountForm.balance`. Two
   * independent symptoms, both reproduced by hand: coming Back to step 1 shows
   * `0` instead of what was typed, and — worse, because the user never sees it
   * happen — the account is *created* with a zero balance, so onboarding ends
   * on a projection built from $0. The name typed beside it survives, and the
   * amount field on step 2 works through the very same `MoneyInput`, which is
   * what makes this specific rather than a broken component.
   *
   * `test.fail()` rather than `test.fixme()` on purpose: this one still runs,
   * so the day the wiring is fixed the suite goes red with "expected to fail
   * but passed" and whoever fixed it is told to delete this annotation. A
   * `fixme` would sit here silently forever.
   *
   * Not fixed in this pull request: this is the test scaffold, and quietly
   * changing application behaviour inside it would bury the finding in a diff
   * nobody is reviewing for that.
   */
  test.fail('carries the step-one balance through to the created account', async ({ page }) => {
    await page.goto('/first-run')

    await page.locator('#onboarding-account-name').fill('Everyday')
    await page.locator('#onboarding-account-balance').fill('2500')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(cardTitle(page, 'Add a bill or paycheck')).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()

    await expect(page.locator('#onboarding-account-balance')).toHaveValue('2500')
  })

  test('offers income as well as bills', async ({ page }) => {
    await page.goto('/first-run')

    await page.locator('#onboarding-account-name').fill('Checking')
    await page.getByRole('button', { name: 'Continue' }).click()

    await segment(page, 'Income').click()
    await page.locator('#onboarding-item-name').fill('Paycheck')
    await page.locator('#onboarding-item-amount').fill('2000')
    await page.getByRole('button', { name: 'Build my runway' }).click()

    const summary = page.getByText(/We'll track Checking against Paycheck/)
    await expect(summary).toBeVisible()
    // Income is signed positive; a bill would render U+2212 here instead.
    await expect(summary).toContainText('+$2,000')
  })
})
