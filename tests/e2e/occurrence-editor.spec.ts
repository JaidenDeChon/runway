/**
 * The occurrence editor, end to end — issue #15.
 *
 * Every test here runs on `emptyHouseholdPage` (user D), the same reasoning
 * `recurring-items.spec.ts` gives: this writes real rows (an occurrence
 * override, a rule split), and running it as user A would corrupt the exact
 * figures `tests/rls/seed-fidelity.test.ts` and `dashboard-states.spec.ts`
 * hold that household to.
 *
 * AC-F1 is the one the plan calls out by name: the editor already opens from
 * both a chart hit-rect and an Upcoming row into the same component
 * (`DayDetailEditor.vue`), but "already emits into the same component" is an
 * implementation fact, not a proof — this asserts both paths actually show
 * the same occurrence content rather than assuming the wiring holds.
 *
 * AC-A4/AC-F6 is the headline test, matching `recurring-items.spec.ts`'s own
 * AC11: the chart's accessible summary reports a different low point after
 * the save, with no reload — a number changing in a list is not the
 * acceptance criterion, the *engine's own projection* moving is.
 *
 * AC-F5 proves revert: the marking disappears and the forecast returns to
 * its pre-edit figure.
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

/**
 * Today, or `daysAhead` from it, as `YYYY-MM-DD` — never a literal date.
 * Whole-day arithmetic in UTC milliseconds throughout; see
 * `recurring-items.spec.ts`'s own copy of this helper for why
 * `new Date(); date.setDate(...)` is the wrong shape here (Playwright's
 * runtime does not resolve this repo's `~~/` alias, so `domain/dates.ts`
 * cannot simply be imported).
 */
function isoDaysFromToday(days: number): string {
  const MS_PER_DAY = 86_400_000
  const todayUtcMidnight = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY
  return new Date(todayUtcMidnight + days * MS_PER_DAY).toISOString().slice(0, 10)
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

/** Creates a monthly bill due on `dueDate` through the UI. */
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

test.describe('opening the editor', () => {
  test('AC-F1: a chart point and an Upcoming row open the same occurrence content', async ({
    emptyHouseholdPage: page,
  }) => {
    await createAccount(page, 'E2E Occurrence Checking', '1000')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Occurrence Open Rent', '250', dueDate)

    await gotoHydrated(page, '/')

    // Path 1: the chart's per-day hit rect (BurndownChart.vue's `data-day`).
    await page.locator(`[data-day="${dueDate}"]`).click()
    const fromChart = page.getByRole('dialog')
    await expect(fromChart.getByText('E2E Occurrence Open Rent')).toBeVisible()
    await expect(fromChart.getByText(`${MINUS}$250`)).toBeVisible()
    await fromChart.getByRole('button', { name: 'Done' }).click()
    await expect(fromChart).not.toBeVisible()

    // Path 2: the same occurrence's row in the Upcoming list.
    await page.getByRole('button', { name: /E2E Occurrence Open Rent/ }).click()
    const fromUpcoming = page.getByRole('dialog')
    await expect(fromUpcoming.getByText('E2E Occurrence Open Rent')).toBeVisible()
    await expect(fromUpcoming.getByText(`${MINUS}$250`)).toBeVisible()
  })
})

test.describe('saving an edit', () => {
  test('AC-A4/AC-F6: editing from the chart moves the forecast, with no reload', async ({
    emptyHouseholdPage: page,
  }) => {
    await createAccount(page, 'E2E Occurrence Edit Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Occurrence Edit Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const before = new RegExp(`Lowest projected balance \\$400 on ${shortDate(dueDate)}`)
    await expect
      .poll(async () => before.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the pre-edit low point ($400) before touching anything',
      })
      .toBe(true)

    await page.locator(`[data-day="${dueDate}"]`).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /E2E Occurrence Edit Rent/ }).click()
    await dialog.locator('#occurrence-amount').fill('700')
    await dialog.getByRole('button', { name: 'Save change' }).click()

    // The form returns to the item list only once the save actually lands —
    // see DayDetailEditor.vue's watch on `saving`. Polled, not asserted once:
    // this is a real network round trip now, not an in-memory update.
    await expect(dialog.getByText('Edited')).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Done' }).click()

    // $500 balance − $700 bill = −$200. No reload between the save above and
    // this read — the chart, and its accessible summary, moved on their own.
    const after = new RegExp(
      `Lowest projected balance ${MINUS}\\$200 on ${shortDate(dueDate)}.*balance goes negative`,
    )
    await expect
      .poll(async () => after.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the chart to report the edited low point with no reload',
      })
      .toBe(true)
  })
})

test.describe('reverting an edit', () => {
  test('AC-F5: reverting restores the rule value and the marking disappears', async ({
    emptyHouseholdPage: page,
  }) => {
    await createAccount(page, 'E2E Occurrence Revert Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Occurrence Revert Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    await page.locator(`[data-day="${dueDate}"]`).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /E2E Occurrence Revert Rent/ }).click()
    await dialog.locator('#occurrence-amount').fill('700')
    await dialog.getByRole('button', { name: 'Save change' }).click()
    await expect(dialog.getByText('Edited')).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Done' }).click()

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const edited = new RegExp(`Lowest projected balance ${MINUS}\\$200 on ${shortDate(dueDate)}`)
    await expect
      .poll(async () => edited.test((await chart.getAttribute('aria-label')) ?? ''))
      .toBe(true)

    // Reopen and revert.
    await page.locator(`[data-day="${dueDate}"]`).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /E2E Occurrence Revert Rent/ }).click()
    await dialog.getByRole('button', { name: 'Revert to rule value' }).click()

    // The "Edited" summary disappears once the revert lands — the same
    // saving/error-driven return to the item list `onSave` uses.
    await expect(dialog.getByText('Edited')).not.toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Done' }).click()

    const restored = new RegExp(`Lowest projected balance \\$400 on ${shortDate(dueDate)}`)
    await expect
      .poll(async () => restored.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the forecast to return to its pre-edit low point after reverting',
      })
      .toBe(true)
  })
})
