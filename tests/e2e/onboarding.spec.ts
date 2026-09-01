/**
 * A real user flow, driven end to end through the running application.
 *
 * First-run onboarding is the right flow to hold this harness up with: it is
 * the only one in the app that *creates* records rather than reading seeded
 * ones, it spans two steps with state that has to survive a Back, and it ends
 * by navigating into the dashboard. If routing, forms, validation, client-side
 * state or navigation break, this fails.
 *
 * It needs the database now, which is worth stating because it did not
 * always: `/first-run` writes a real account row (issue #7), so this runs on
 * `emptyHouseholdPage` — user D's empty household — rather than
 * `authenticatedPage`. Running it as user A would add an account to A's
 * household on every pass, which `tests/rls/seed-fidelity.test.ts`'s
 * exact-list assertion would then fail on. See tests/e2e/fixtures.ts.
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
  test('takes a new user from nothing to a projection', async ({ emptyHouseholdPage: page }) => {
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

    // Name alone is not enough now: recurring_rules.amount_cents > 0 rejects
    // the step's $0 default, so the button stays disabled until an amount is
    // typed too — see RecurringItemStepCard.vue's isValid.
    await page.locator('#onboarding-item-name').fill('Rent')
    await expect(buildButton).toBeDisabled()
    await page.locator('#onboarding-item-amount').fill('1200')
    await expect(buildButton).toBeEnabled()
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

  test('keeps step-one values when the user goes back', async ({ emptyHouseholdPage: page }) => {
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
    // second was the genuine `step` defect, now fixed and regression-tested
    // below. Keeping
    // the value whole here means this test measures what it claims to — that
    // Back preserves state — and not the defect, which has its own test.
    await expect(page.locator('#onboarding-account-name')).toHaveValue('Everyday')
    await expect(page.locator('#onboarding-account-balance')).toHaveValue('2500')
  })

  /**
   * A real, user-facing defect this harness found, and the regression test for
   * the fix.
   *
   * `MoneyInput` rendered `<input type="number">` with no `step`, so the HTML
   * default of `step=1` applied. Any amount with cents was then a
   * `stepMismatch`: the input reported `checkValidity() === false`, and because
   * both first-run step cards wrap their fields in a real `<form>` with a
   * `type="submit"` button, **the whole form became unsubmittable**. A user who
   * typed 812.34 as their opening balance could not press Continue at all.
   *
   * Measured directly at the time, not deduced from a timeout:
   *
   *     2500   -> { step: null, stepMismatch: false, formValid: true  }
   *     812.34 -> { step: null, stepMismatch: true,  formValid: false }
   *
   * Fixed at the time by `step="0.01"`. The fix is now structural instead:
   * `MoneyInput` renders `type="text"` with `inputmode="decimal"`, which keeps
   * the numeric keypad on mobile and takes the whole step-validation mechanism
   * off the table — a text input has no `step` to mismatch, so this defect
   * cannot come back by way of somebody dropping an attribute. (The field moved
   * to `text` so that a lone `"-"` can be typed and then completed, which
   * `type="number"` blanks; see the component's own comment for the rest.)
   *
   * The assertions below stayed at both levels through that change — the form
   * advances, *and* the browser reports the field valid — because only the
   * second one distinguishes "the field is enterable" from "some other change
   * happened to make Continue clickable". What they say about the *mechanism*
   * moved with it: asserting `step="0.01"` on a field that no longer has a step
   * would be asserting a fix that is no longer how this works.
   */
  test('accepts an opening balance that has cents in it', async ({ emptyHouseholdPage: page }) => {
    await gotoHydrated(page, '/first-run')

    const continueButton = page.getByRole('button', { name: 'Continue' })
    await page.locator('#onboarding-account-name').fill('Everyday')
    await expect(continueButton).toBeEnabled()
    const balance = page.locator('#onboarding-account-balance')
    await balance.fill('812.34')

    // The defect, asserted where it actually lived. `stepMismatch` is the flag
    // that was set; the form's own validity is what it cost the user.
    const validity = await balance.evaluate((element) => {
      const input = element as HTMLInputElement
      return {
        type: input.type,
        inputMode: input.inputMode,
        stepMismatch: input.validity.stepMismatch,
        formValid: input.form?.checkValidity() ?? null,
      }
    })
    expect(validity).toEqual({
      type: 'text',
      // Still a numeric keypad on a phone. That is the half of `type="number"`
      // worth keeping here, and the only half.
      inputMode: 'decimal',
      stepMismatch: false,
      formValid: true,
    })

    await clickUntil(continueButton, cardTitle(page, 'Add a bill or paycheck'))

    // The cents survived the step, rather than being rounded away on the way in.
    await clickUntil(
      page.getByRole('button', { name: 'Back' }),
      page.locator('#onboarding-account-name'),
    )
    await expect(page.locator('#onboarding-account-balance')).toHaveValue('812.34')
  })

  test('offers income as well as bills', async ({ emptyHouseholdPage: page }) => {
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
    await expect(buildButton).toBeDisabled()
    await page.locator('#onboarding-item-amount').fill('2000')
    await expect(buildButton).toBeEnabled()
    await clickUntil(buildButton, cardTitle(page, "You're set."))

    const summary = page.getByText(/We'll track Checking against Paycheck/)
    await expect(summary).toBeVisible()
    // Income is signed positive; a bill would render U+2212 here instead.
    await expect(summary).toContainText('+$2,000')
  })
})
