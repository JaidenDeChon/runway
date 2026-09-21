/**
 * The Upcoming list's editable amounts, and the what-if switch in the header.
 *
 * Two changes that only make sense together. The header switch decides whether
 * the dashboard's numbers are the real ones or a hypothesis; the Upcoming
 * rows' three buttons — Update one, Update all, Reset — are what you press
 * under either. So the tests here are paired: the same gesture, once with the
 * switch off (it writes, and survives a reload) and once with it on (it
 * previews, moves the same chart, and leaves every row untouched).
 *
 * Everything runs on `emptyHouseholdPage` (user D), the reason
 * `occurrence-editor.spec.ts` gives: these write real rows, and running them
 * as user A would corrupt the figures `tests/rls/seed-fidelity.test.ts` holds
 * that household to.
 *
 * The assertions are the chart's accessible summary, not the row's own text,
 * wherever the question is "did the projection move?" — a figure changing in
 * the list it was typed into proves only that the field echoed a keystroke.
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

/** Today, or `daysAhead` from it, as `YYYY-MM-DD` — never a literal date. */
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

async function createBill(
  page: import('@playwright/test').Page,
  name: string,
  amount: string,
  dueDate: string,
): Promise<void> {
  await gotoHydrated(page, '/recurring-items')
  const dialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('button', { name: 'Add recurring item' }), dialog)
  await page.locator('#recurring-name').fill(name)
  await page.locator('#recurring-amount').fill(amount)
  await page.locator('#recurring-next-occurrence').fill(dueDate)
  const row = page.getByRole('button', { name: `Edit ${name}` })
  await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)
  await expect(row).toBeVisible()
}

/**
 * The row's amount field, by the label `amountFieldLabel` builds.
 *
 * Named rather than positional because the whole point of that label is that
 * fourteen fields called "Amount" cannot be told apart — including by a test.
 */
function amountField(
  page: import('@playwright/test').Page,
  label: string,
  date: string,
): import('@playwright/test').Locator {
  return page.getByLabel(`${label} on ${shortDate(date)} amount in dollars`)
}

test.describe('the what-if switch in the header', () => {
  test('is on the dashboard and nowhere else', async ({ emptyHouseholdPage: page }) => {
    // The mode previews the dashboard's projection; a switch that did nothing
    // on three screens out of four would be worse than no switch.
    await gotoHydrated(page, '/')
    await expect(page.getByRole('switch', { name: 'What-if mode' })).toBeVisible()

    await gotoHydrated(page, '/accounts')
    await expect(page.getByRole('switch', { name: 'What-if mode' })).toHaveCount(0)
  })

  test('drives the same mode the day editor does', async ({ emptyHouseholdPage: page }) => {
    // One session, two controls. They share `useWhatIf()`, and the failure
    // this pins is the obvious one: two copies of the state, each convinced
    // it is the mode.
    await createAccount(page, 'E2E Header Switch Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Header Switch Rent', '100', dueDate)

    await gotoHydrated(page, '/')
    await page.getByRole('switch', { name: 'What-if mode' }).click()

    // The bar is the page's answer to the header's switch, so its appearance
    // is the proof the two are the same state rather than two booleans.
    await expect(page.locator('[data-slot="what-if-bar"]')).toBeVisible()

    await page.locator(`[data-day="${dueDate}"]`).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('switch', { name: 'What-if mode' })).toBeChecked()
  })
})

test.describe('editing an amount from the Upcoming list', () => {
  test('Update one saves the change and survives a reload', async ({
    emptyHouseholdPage: page,
  }) => {
    await createAccount(page, 'E2E Quick Edit Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Quick Edit Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const before = new RegExp(`Lowest projected balance \\$400 on ${shortDate(dueDate)}`)
    await expect
      .poll(async () => before.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the pre-edit low point ($400) before touching anything',
      })
      .toBe(true)

    // Signed, like every amount in the app: a bill is a negative delta, and
    // the field shows the magnitude beside its own minus toggle.
    await amountField(page, 'E2E Quick Edit Rent', dueDate).fill('700')
    await page
      .getByRole('button', { name: `Update E2E Quick Edit Rent on ${shortDate(dueDate)} only` })
      .click()

    const after = new RegExp(
      `Lowest projected balance ${MINUS}\\$200 on ${shortDate(dueDate)}.*balance goes negative`,
    )
    await expect
      .poll(async () => after.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the inline save to move the forecast, with no reload',
        timeout: 10_000,
      })
      .toBe(true)

    // The half that separates a save from a preview: it is a row now.
    await gotoHydrated(page, '/')
    await expect
      .poll(async () => after.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the inline save to survive a reload',
      })
      .toBe(true)
  })

  test('Reset puts a saved edit back to the rule value', async ({ emptyHouseholdPage: page }) => {
    await createAccount(page, 'E2E Quick Reset Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Quick Reset Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const unedited = new RegExp(`Lowest projected balance \\$400 on ${shortDate(dueDate)}`)

    await amountField(page, 'E2E Quick Reset Rent', dueDate).fill('700')
    await page
      .getByRole('button', { name: `Update E2E Quick Reset Rent on ${shortDate(dueDate)} only` })
      .click()

    // Reset's label says which of its three meanings is live, so the test can
    // assert that the destructive one — reverting a stored override — is the
    // one on offer here rather than merely clearing the field.
    const revert = page.getByRole('button', {
      name: `Revert E2E Quick Reset Rent on ${shortDate(dueDate)} to its rule value`,
    })
    await expect(revert).toBeVisible({ timeout: 10_000 })
    await revert.click()

    await expect
      .poll(async () => unedited.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the revert to put the forecast back to the rule value',
        timeout: 10_000,
      })
      .toBe(true)
  })
})

test.describe('editing an amount with what-if on', () => {
  test('previews instead of saving, and discards cleanly', async ({ emptyHouseholdPage: page }) => {
    await createAccount(page, 'E2E Quick Preview Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Quick Preview Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const unedited = new RegExp(`Lowest projected balance \\$400 on ${shortDate(dueDate)}`)
    const previewed = new RegExp(`Lowest projected balance ${MINUS}\\$200 on ${shortDate(dueDate)}`)

    await page.getByRole('switch', { name: 'What-if mode' }).click()

    await amountField(page, 'E2E Quick Preview Rent', dueDate).fill('700')
    await page
      .getByRole('button', { name: `Update E2E Quick Preview Rent on ${shortDate(dueDate)} only` })
      .click()

    // The engine saw it — the preview is a different window onto the same
    // stored records, never a second calculation path.
    await expect
      .poll(async () => previewed.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the previewed amount to reach the projection',
      })
      .toBe(true)

    const bar = page.locator('[data-slot="what-if-bar"]')
    await expect(bar.getByText('1 previewed change')).toBeVisible()

    // And nothing was written: leaving the mode returns the forecast to the
    // rule's own figure, and a reload agrees.
    await bar.getByRole('button', { name: 'Exit what-if' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Discard changes' }).click()
    await expect(bar).toBeHidden()

    await gotoHydrated(page, '/')
    await expect
      .poll(async () => unedited.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the discarded preview to leave no trace in the database',
      })
      .toBe(true)
  })

  test('Reset drops the preview and never touches what is stored', async ({
    emptyHouseholdPage: page,
  }) => {
    // The state that makes this worth pinning: a row that is *both* saved-over
    // and previewed. Reset with the mode on must undo the preview only —
    // reverting the stored edit would delete something the user never asked
    // to lose.
    await createAccount(page, 'E2E Preview Reset Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Preview Reset Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const saved = new RegExp(`Lowest projected balance \\$200 on ${shortDate(dueDate)}`)

    // A real save first: $500 − $300 = $200.
    await amountField(page, 'E2E Preview Reset Rent', dueDate).fill('300')
    await page
      .getByRole('button', { name: `Update E2E Preview Reset Rent on ${shortDate(dueDate)} only` })
      .click()
    await expect
      .poll(async () => saved.test((await chart.getAttribute('aria-label')) ?? ''), {
        timeout: 10_000,
      })
      .toBe(true)

    // Then a preview on top of it: $500 − $700 = −$200.
    await page.getByRole('switch', { name: 'What-if mode' }).click()
    await amountField(page, 'E2E Preview Reset Rent', dueDate).fill('700')
    await page
      .getByRole('button', { name: `Update E2E Preview Reset Rent on ${shortDate(dueDate)} only` })
      .click()

    const discard = page.getByRole('button', {
      name: `Discard the previewed change to E2E Preview Reset Rent on ${shortDate(dueDate)}`,
    })
    await expect(discard).toBeVisible()
    await discard.click()

    // Back to the *saved* figure, not to the rule's — the stored edit is
    // still there, which is the whole assertion.
    await expect
      .poll(async () => saved.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected dropping the preview to leave the saved override standing',
      })
      .toBe(true)
  })
})
