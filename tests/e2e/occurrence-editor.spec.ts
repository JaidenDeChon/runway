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
 *
 * The what-if test is not an acceptance criterion — issue #16 owns what-if
 * mode — but the save path this issue rebuilt runs through the same button,
 * and a preview has no network round trip to close the edit form on. That
 * asymmetry is exactly the kind that rots silently, so it is pinned here.
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

test.describe('previewing an edit', () => {
  test('a what-if preview returns to the item list, moves the forecast, and survives closing the editor', async ({
    emptyHouseholdPage: page,
  }) => {
    await createAccount(page, 'E2E Occurrence Preview Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E Occurrence Preview Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const unedited = new RegExp(`Lowest projected balance \\$400 on ${shortDate(dueDate)}`)
    await expect
      .poll(async () => unedited.test((await chart.getAttribute('aria-label')) ?? ''))
      .toBe(true)

    await page.locator(`[data-day="${dueDate}"]`).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('switch', { name: 'What-if mode' }).click()
    await dialog.getByRole('button', { name: /E2E Occurrence Preview Rent/ }).click()
    await dialog.locator('#occurrence-amount').fill('700')
    await dialog.getByRole('button', { name: 'Preview change' }).click()

    // The regression this test exists for: a preview never round-trips, so
    // there is no `saving` edge to close the form on — it has to close from
    // `onSave` itself, or the editor strands the user on the edit form.
    // `Done` only renders in the item list, so its return *is* the assertion.
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible()

    // Read the day's balance from inside the sheet rather than off the chart's
    // aria-label: the sheet is modal, so everything behind it leaves the
    // accessibility tree and `getByRole('img')` cannot resolve the chart while
    // it is open. This is the same figure — `activeBalances` and the chart are
    // both views onto the one `projection` computed in index.vue — so $500
    // opening balance − $700 previewed bill = −$200 proves the preview reached
    // the engine, not just the form.
    await expect(dialog.getByText(`${MINUS}$200`)).toBeVisible()

    // Closing the editor no longer ends the mode — issue #16 made what-if a
    // property of the page, so the preview survives the sheet and the chart
    // keeps showing it. Closing therefore discards nothing and asks nothing.
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    const bar = page.locator('[data-slot="what-if-bar"]')
    await expect(bar).toBeVisible()
    await expect(bar.getByText('1 previewed change')).toBeVisible()

    // The preview is still in the forecast with the sheet gone — which is the
    // whole point of the mode outliving the editor, and is now readable off
    // the chart again because nothing modal is covering it.
    const previewed = new RegExp(`Lowest projected balance ${MINUS}\\$200 on ${shortDate(dueDate)}`)
    await expect
      .poll(async () => previewed.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the preview to survive closing the editor',
      })
      .toBe(true)

    // Leaving the mode is what destroys something, so that is what asks.
    await bar.getByRole('button', { name: 'Exit what-if' }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm.getByText('1 previewed change will be lost')).toBeVisible()

    // Backing out leaves the session exactly as it was — the preview is still
    // in the projection, which is the half of a confirmation that actually
    // protects anything, and the half that would still pass if "Keep" quietly
    // discarded.
    await confirm.getByRole('button', { name: 'Keep previewing' }).click()
    await expect(bar).toBeVisible()
    await expect
      .poll(async () => previewed.test((await chart.getAttribute('aria-label')) ?? ''))
      .toBe(true)

    // And confirming discards: nothing was ever written, so the forecast
    // returns to the rule's own figure and the bar goes with it.
    await bar.getByRole('button', { name: 'Exit what-if' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Discard changes' }).click()
    await expect(bar).toBeHidden()
    await expect
      .poll(async () => unedited.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the discarded preview to leave no trace on the forecast',
      })
      .toBe(true)
  })

  test('an untouched what-if session leaves without stopping to ask', async ({
    emptyHouseholdPage: page,
  }) => {
    // The other half of the confirmation's contract, and the easier one to
    // get wrong: a prompt that fires when there is nothing to lose is a
    // prompt people learn to dismiss without reading.
    await createAccount(page, 'E2E What-If Untouched Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E What-If Untouched Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    await page.locator(`[data-day="${dueDate}"]`).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('switch', { name: 'What-if mode' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    const bar = page.locator('[data-slot="what-if-bar"]')
    await expect(bar.getByText('Nothing previewed yet')).toBeVisible()
    await bar.getByRole('button', { name: 'Exit what-if' }).click()
    await expect(bar).toBeHidden()
  })

  test('promoting a preview saves it as a real edit and ends the mode', async ({
    emptyHouseholdPage: page,
  }) => {
    // The issue's acceptance criterion for promotion is that the result is
    // indistinguishable from making the edit directly, so this asserts the
    // two things a direct save produces: the "Edited" marking on the
    // occurrence, and a forecast that survives a reload. A promotion that
    // only updated the page's own state would pass neither.
    await createAccount(page, 'E2E What-If Promote Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E What-If Promote Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })

    await page.locator(`[data-day="${dueDate}"]`).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('switch', { name: 'What-if mode' }).click()
    await dialog.getByRole('button', { name: /E2E What-If Promote Rent/ }).click()
    await dialog.locator('#occurrence-amount').fill('700')
    await dialog.getByRole('button', { name: 'Preview change' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()

    const bar = page.locator('[data-slot="what-if-bar"]')
    await bar.getByRole('button', { name: 'Save changes' }).click()

    // The mode ends on success — the previews became real, so there is
    // nothing left to preview.
    await expect(bar).toBeHidden({ timeout: 10_000 })

    const saved = new RegExp(
      `Lowest projected balance ${MINUS}\\$200 on ${shortDate(dueDate)}.*balance goes negative`,
    )
    await expect
      .poll(async () => saved.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the promoted edit to move the forecast like a direct save',
      })
      .toBe(true)

    // The half that separates a promotion from a preview: it survives a
    // reload, because it is a row now.
    await gotoHydrated(page, '/')
    await expect(page.locator('[data-slot="what-if-bar"]')).toBeHidden()
    await expect
      .poll(async () => saved.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected the promoted edit to survive a reload',
      })
      .toBe(true)

    // And it is marked as an edit, exactly as a direct save is (AC-F5's
    // marking, asserted by the saving test above).
    await page.locator(`[data-day="${dueDate}"]`).click()
    await expect(page.getByRole('dialog').getByText('Edited')).toBeVisible()
  })

  test('a reload during what-if drops the previews', async ({ emptyHouseholdPage: page }) => {
    // The issue asks that navigating away, reloading or an expired session
    // discard cleanly. The scratch list is page-local state and nothing
    // persists it, so this passes by construction — which is exactly why it
    // needs a test: the day someone "helpfully" adds sessionStorage, nothing
    // else here would notice.
    await createAccount(page, 'E2E What-If Reload Checking', '500')
    const dueDate = isoDaysFromToday(6)
    await createBill(page, 'E2E What-If Reload Rent', '100', dueDate)

    await gotoHydrated(page, '/')

    await page.locator(`[data-day="${dueDate}"]`).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('switch', { name: 'What-if mode' }).click()
    await dialog.getByRole('button', { name: /E2E What-If Reload Rent/ }).click()
    await dialog.locator('#occurrence-amount').fill('700')
    await dialog.getByRole('button', { name: 'Preview change' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()

    await expect(page.locator('[data-slot="what-if-bar"]')).toBeVisible()

    await gotoHydrated(page, '/')

    await expect(page.locator('[data-slot="what-if-bar"]')).toBeHidden()
    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const unedited = new RegExp(`Lowest projected balance \\$400 on ${shortDate(dueDate)}`)
    await expect
      .poll(async () => unedited.test((await chart.getAttribute('aria-label')) ?? ''), {
        message: 'expected a reload to leave no previewed value behind',
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
