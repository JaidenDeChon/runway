/**
 * Settling an occurrence, end to end — issue #26's manual half, and the
 * prediction window's writer from issue #18.
 *
 * What it covers:
 *  - "Mark as received" in the day editor, twice, on two paychecks that
 *    already happened, moves the estimate every later paycheck carries to
 *    their mean — the promise the callout makes ("Estimates learn from it") —
 *    and the settled rows keep their `Received` badge across a reload;
 *  - "Undo received" takes a settlement back, and the estimate with it;
 *  - the Estimates card on `/accounts` saves a new window, and it persists.
 *
 * Runs on `emptyHouseholdPage` (user D), for the reason every write-flow spec
 * gives: it writes real rows, and A and C are held to exact figures by
 * `tests/rls/seed-fidelity.test.ts` and `dashboard-states.spec.ts`.
 * `resetEmptyHousehold` deletes D's accounts before and after each test —
 * the cascade takes the rule and every occurrence with it — and puts D's
 * `prediction_window` back to 3.
 *
 * **Why a weekly paycheck anchored thirteen days ago.** The dashboard's chart
 * looks back fourteen days (`LOOKBACK_DAYS` in `app/pages/index.vue`), so a
 * weekly rule anchored at `today - 13` puts two paychecks that have already
 * happened on the chart, where the day editor can reach them, and its next
 * one at `today + 1`, in the Upcoming list. Two settled amounts is the fewest
 * an estimate is made from (`MIN_PREDICTION_WINDOW`).
 *
 * The one step that does not go through the UI is the Undo test's setup: it
 * settles through D's *own* session, calling the same `settle_occurrence` the
 * button calls, because the first test already proves the button and the
 * Undo test is about what comes after it (CLAUDE.md: "Seed fixtures go in
 * through a user's own session").
 */

import { signedInClient, USER_D } from '../support/database'
import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

type Page = import('@playwright/test').Page

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

async function createAccount(page: Page, name: string, balance: string): Promise<void> {
  await gotoHydrated(page, '/accounts')
  const dialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)
  await page.locator('#account-name').fill(name)
  await page.locator('#account-balance').fill(balance)
  const row = page.getByRole('button', { name: `Edit ${name}` })
  await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
  await expect(row).toBeVisible()
}

/** A weekly income item set to "Predict from deposits", `fallback` being the typed amount in use until history exists. */
async function createWeeklyPredictedIncome(
  page: Page,
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
  await page.locator('#recurring-amount').fill(fallback)
  await page.locator('#recurring-cadence').click()
  await page.getByRole('option', { name: 'Weekly', exact: true }).click()
  await expect(page.locator('#recurring-cadence')).toContainText('Weekly')
  await page.locator('#recurring-next-occurrence').fill(firstDate)
  const row = page.getByRole('button', { name: `Edit ${name}` })
  await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)
  await expect(row).toBeVisible()
}

/** The Upcoming list's amount field for one occurrence, by the label `amountFieldLabel` builds. */
function upcomingAmount(page: Page, name: string, date: string) {
  return page.getByLabel(`${name} on ${shortDate(date)} amount in dollars`)
}

/**
 * Opens the day editor on `date` and returns the dialog and the named
 * occurrence's row in it.
 *
 * Clicks near the bottom of the day's hit rect rather than its centre. These
 * days sit at the chart's left edge, under the pinned annotation labels, and
 * at 375px a label's popover trigger covers the centre of a rect that narrow —
 * a user taps the column below it, and so does this.
 */
async function openDay(page: Page, date: string, name: string) {
  const hit = page.locator(`[data-day="${date}"]`)
  const box = await hit.boundingBox()
  if (!box) throw new Error(`the chart has no hit target for ${date}`)
  await hit.click({ position: { x: box.width / 2, y: box.height - 4 } })
  const day = page.getByRole('dialog')
  await expect(day).toBeVisible()
  return { day, occurrence: day.getByRole('button', { name: new RegExp(name) }) }
}

/** Opens `date`'s paycheck in the day editor, types `amount`, and presses "Mark as received". */
async function markReceived(page: Page, date: string, name: string, amount: string) {
  const { day, occurrence } = await openDay(page, date, name)
  await occurrence.click()
  await day.locator('#occurrence-amount').fill(amount)
  await day.getByRole('button', { name: 'Mark as received', exact: true }).click()
  // Back on the item list once the write lands, with the row now settled.
  await expect(occurrence).toContainText('Received', { timeout: 10_000 })
  await day.getByRole('button', { name: 'Done' }).click()
  await expect(day).toBeHidden()
}

/** Settles through D's own session, with the same RPC the button calls. */
async function settleForUserD(
  ruleName: string,
  settled: readonly { readonly date: string; readonly cents: number }[],
): Promise<void> {
  const client = await signedInClient(USER_D)
  try {
    const { data: rule, error: ruleError } = await client
      .from('recurring_rules')
      .select('id')
      .eq('name', ruleName)
      .single()
    if (ruleError || !rule) throw new Error(`could not find D's rule: ${ruleError?.code}`)
    for (const row of settled) {
      const { error } = await client.rpc('settle_occurrence', {
        p_rule_id: rule.id,
        p_projected_date: row.date,
        p_projected_amount_cents: 200_000,
        p_actual_amount_cents: row.cents,
        p_actual_date: row.date,
      })
      if (error) throw new Error(`could not settle D's occurrence: ${error.code}`)
    }
  } finally {
    // Local scope: a global sign-out would revoke the browser's session for D too.
    await client.auth.signOut({ scope: 'local' })
  }
}

test.describe('settling an occurrence', () => {
  test('marking two paychecks received moves the next one to their mean, and the badges survive a reload', async ({
    emptyHouseholdPage: page,
  }) => {
    const name = 'E2E Settled Paycheck'
    const first = isoDaysFromToday(-13)
    const second = isoDaysFromToday(-6)
    const next = isoDaysFromToday(1)
    await createAccount(page, 'E2E Settle Checking', '1000')
    await createWeeklyPredictedIncome(page, name, '2000', first)

    await gotoHydrated(page, '/')
    // Before any history, the typed fallback is the estimate in use.
    await expect(upcomingAmount(page, name, next)).toHaveValue('2000')

    await markReceived(page, first, name, '2400')
    // One settled amount is not history yet: still the fallback.
    await expect(upcomingAmount(page, name, next)).toHaveValue('2000')

    await markReceived(page, second, name, '2500')
    // Two are. Every later paycheck moves to their mean, without anybody
    // touching the item itself.
    await expect(upcomingAmount(page, name, next)).toHaveValue('2450')

    await gotoHydrated(page, '/')
    await expect(upcomingAmount(page, name, next)).toHaveValue('2450')
    const upcomingRow = page.getByRole('button', {
      name: new RegExp(`${shortDate(next)}.*${name}.*Estimated amount`),
    })
    await expect(upcomingRow).toBeVisible()

    // The settled rows are still settled after the reload, and read as what
    // happened rather than as an estimate.
    for (const [date, amount] of [
      [first, '$2,400'],
      [second, '$2,500'],
    ] as const) {
      const { day, occurrence } = await openDay(page, date, name)
      await expect(occurrence).toContainText('Received')
      await expect(occurrence).toContainText(amount)
      await expect(occurrence).not.toContainText('Estimated amount')
      await day.getByRole('button', { name: 'Done' }).click()
      await expect(day).toBeHidden()
    }
  })

  test('"Undo received" takes a settlement back, and the estimate with it', async ({
    emptyHouseholdPage: page,
  }) => {
    const name = 'E2E Undo Paycheck'
    const first = isoDaysFromToday(-13)
    const second = isoDaysFromToday(-6)
    const next = isoDaysFromToday(1)
    await createAccount(page, 'E2E Undo Checking', '1000')
    await createWeeklyPredictedIncome(page, name, '2000', first)
    await settleForUserD(name, [
      { date: first, cents: 240_000 },
      { date: second, cents: 250_000 },
    ])

    await gotoHydrated(page, '/')
    await expect(upcomingAmount(page, name, next)).toHaveValue('2450')

    const { day, occurrence } = await openDay(page, second, name)
    await expect(occurrence).toContainText('Received')
    await occurrence.click()
    // A settled occurrence opens as a summary with the way back, not a form.
    await expect(day.getByText('Settled occurrence')).toBeVisible()
    await expect(day.locator('#occurrence-amount')).toHaveCount(0)
    await day.getByRole('button', { name: 'Undo received' }).click()

    // Back on the day's list once the write lands, as after any other save,
    // with the row an ordinary estimated paycheck at the rule's value again.
    await expect(occurrence).not.toContainText('Received', { timeout: 10_000 })
    await expect(occurrence).toContainText('Estimated amount')
    await expect(occurrence).toContainText('$2,000')
    await day.getByRole('button', { name: 'Done' }).click()
    await expect(day).toBeHidden()

    // One settled amount left is not enough history: the fallback again.
    await expect(upcomingAmount(page, name, next)).toHaveValue('2000')

    await gotoHydrated(page, '/')
    await expect(upcomingAmount(page, name, next)).toHaveValue('2000')
    const reopened = await openDay(page, second, name)
    await expect(reopened.occurrence).not.toContainText('Received')
    await expect(reopened.occurrence).toContainText('Estimated amount')
  })

  test('the Estimates card saves a new window, and it persists across a reload', async ({
    emptyHouseholdPage: page,
  }) => {
    await createAccount(page, 'E2E Window Checking', '1000')
    await gotoHydrated(page, '/accounts')

    const trigger = page.locator('#prediction-window')
    const save = page.locator('#prediction-window-save')
    await expect(trigger).toContainText('3 amounts')
    // Nothing to save until something changes.
    await expect(save).toBeDisabled()

    await trigger.click()
    await page.getByRole('option', { name: '5 amounts' }).click()
    await expect(trigger).toContainText('5 amounts')
    await save.click()
    // Scoped to the card: <NuxtRouteAnnouncer> puts a role="status" on every page.
    const card = page.locator('[data-slot="card"]').filter({ has: trigger })
    await expect(card.getByRole('status')).toHaveText('Saved.')
    await expect(save).toBeDisabled()

    await gotoHydrated(page, '/accounts')
    await expect(page.locator('#prediction-window')).toContainText('5 amounts')
  })
})
