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
import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

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
    await gotoHydrated(page, '/first-run')

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
    await clickUntil(continueButton, cardTitle(page, 'Add a bill or paycheck'))

    // --- Step 2: the recurring item -----------------------------------------
    await expect(cardTitle(page, 'Add a bill or paycheck')).toBeVisible()

    const buildButton = page.getByRole('button', { name: 'Build my runway' })
    await expect(buildButton).toBeDisabled()

    await page.locator('#onboarding-item-name').fill('Rent')
    await expect(buildButton).toBeEnabled()
    await page.locator('#onboarding-item-amount').fill('1200')
    await clickUntil(buildButton, cardTitle(page, "You're set."))

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
    // A plain click, deliberately: `NuxtLink` renders a real `<a href="/">`, so
    // the browser follows it whether or not Vue has taken over yet. This is the
    // one interaction in the flow that does not depend on hydration, and
    // routing it through `clickUntil` was actively wrong — the "consequence"
    // locator matched the done card that was already on screen, so the helper
    // returned satisfied without ever clicking.
    await page.getByRole('link', { name: 'See your runway' }).click()
    await page.waitForURL(/\/$/)
    await expect(page).toHaveTitle(/Home/)
  })

  test('keeps step-one values when the user goes back', async ({ page }) => {
    await gotoHydrated(page, '/first-run')

    const continueButton = page.getByRole('button', { name: 'Continue' })
    await page.locator('#onboarding-account-name').fill('Everyday')
    // Continue can only enable through Vue reactivity, so this is proof the
    // card is listening — not a guess that enough time has passed. Typing a
    // value before this point is dropped silently; see ./fixtures.ts.
    await expect(continueButton).toBeEnabled()

    await page.locator('#onboarding-account-balance').fill('2500')
    await clickUntil(continueButton, cardTitle(page, 'Add a bill or paycheck'))

    await clickUntil(
      page.getByRole('button', { name: 'Back' }),
      page.locator('#onboarding-account-name'),
    )

    // The step components unmount and remount; the form state lives above them
    // precisely so this round trip is lossless.
    //
    // A whole-dollar balance here on purpose. This assertion was the one that
    // first looked like "onboarding loses the balance" — twice, for two
    // unrelated reasons, neither of them the one originally reported. The first
    // was this test racing hydration (see `gotoHydrated` in ./fixtures.ts); the
    // second is the genuine `step` defect isolated in the test below. Keeping
    // the value whole here means this test measures what it claims to — that
    // Back preserves state — and not the defect, which has its own test.
    await expect(page.locator('#onboarding-account-name')).toHaveValue('Everyday')
    await expect(page.locator('#onboarding-account-balance')).toHaveValue('2500')
  })

  /**
   * A real, user-facing defect, found by this harness and verified at the
   * browser level rather than inferred.
   *
   * `MoneyInput` renders `<input type="number">` and sets no `step`, so the
   * HTML default of `step=1` applies. Any amount with cents is then a
   * `stepMismatch`: the input reports `checkValidity() === false`, and because
   * both first-run step cards wrap their fields in a real `<form>` with a
   * `type="submit"` button, **the whole form becomes unsubmittable**. A user who
   * types 812.34 as their opening balance cannot press Continue at all.
   *
   * Measured directly, not deduced from a timeout:
   *
   *     2500   -> { step: null, stepMismatch: false, formValid: true  }
   *     812.34 -> { step: null, stepMismatch: true,  formValid: false }
   *
   * This is browser validation, so it is not specific to the dev server and not
   * a hydration artifact — it reproduces against the production preview too.
   * For an application whose stated rule is that money *is* integer cents, a
   * money field that rejects cents is worth fixing deliberately.
   *
   * The fix is one attribute — `step="0.01"` on the input inside
   * `app/components/MoneyInput.vue` — but it is an application change, and this
   * pull request is the test scaffold. Raised rather than silently resolved,
   * per CLAUDE.md. Delete this annotation when it lands.
   */
  test.fail('accepts an opening balance that has cents in it', async ({ page }) => {
    await gotoHydrated(page, '/first-run')

    const continueButton = page.getByRole('button', { name: 'Continue' })
    await page.locator('#onboarding-account-name').fill('Everyday')
    await expect(continueButton).toBeEnabled()
    await page.locator('#onboarding-account-balance').fill('812.34')
    await continueButton.click()

    await expect(cardTitle(page, 'Add a bill or paycheck')).toBeVisible({ timeout: 5_000 })
  })

  test('offers income as well as bills', async ({ page }) => {
    await gotoHydrated(page, '/first-run')

    const continueButton = page.getByRole('button', { name: 'Continue' })
    await page.locator('#onboarding-account-name').fill('Checking')
    await expect(continueButton).toBeEnabled()
    await clickUntil(continueButton, cardTitle(page, 'Add a bill or paycheck'))

    // The segmented control is inside the step-2 card, which `clickUntil` above
    // has already proven is mounted and listening.
    await segment(page, 'Income').click()
    const buildButton = page.getByRole('button', { name: 'Build my runway' })
    await page.locator('#onboarding-item-name').fill('Paycheck')
    await expect(buildButton).toBeEnabled()
    await page.locator('#onboarding-item-amount').fill('2000')
    await clickUntil(buildButton, cardTitle(page, "You're set."))

    const summary = page.getByText(/We'll track Checking against Paycheck/)
    await expect(summary).toBeVisible()
    // Income is signed positive; a bill would render U+2212 here instead.
    await expect(summary).toContainText('+$2,000')
  })
})
