/**
 * The dashboard's verdict bands, and the two preferences that steer them.
 *
 * `evaluate()` (domain/projection.ts) draws two lines across the margin
 * between the running low and the cushion: `TIGHT_THRESHOLD` ($250) splits
 * covered from tight, and $0 splits tight from short. Nothing here recomputes
 * that rule — every test just puts a household on one side of a line the
 * engine already drew and reads the badge back.
 *
 * All of it runs on `emptyHouseholdPage` (user D), and that choice is what
 * keeps these tests honest rather than merely convenient: D's seeded cushion
 * is a flat $600 and `monthly_discretionary_cents` is 0 with no discretionary
 * source, so one account with no recurring rules draws a flat line. A flat
 * line's low point is every point, so the verdict is arithmetic on the
 * account balance and the cushion alone — never a hostage to which day this
 * suite happens to run on. Two accounts summed the same way is what makes
 * the account-selection tests below arithmetic too: hide one and the verdict
 * moves by exactly its balance, nothing else in the calendar involved.
 *
 * The overdrawn / negative-balance state is deliberately not re-tested here —
 * `tests/e2e/negative-balances.spec.ts:139` already drives it end to end.
 *
 * The last test is different on purpose. It runs on `shortHouseholdPage`
 * (user C), which `domain/seed.test.ts:53,68` proves is short at every
 * horizon the dashboard offers, on every day for over a year — a household
 * built to demonstrate the short band rather than one this suite arranges
 * into it. That fixture is read-only by contract (see its doc comment in
 * `./fixtures`), so that test asserts only the band, never a figure, and
 * clicks nothing: a click on that page would be a write the fixture is not
 * allowed to make.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

/** U+00B7, the middot the forecast card's subtitle is built with. */
const MIDDOT = '·'

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

/** `LowestBalanceCard`, scoped by its own heading rather than by position on the page. */
function lowestBalanceCard(page: import('@playwright/test').Page) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: 'Lowest projected balance' }) })
}

/** `AccountLegendRow`'s checkbox for one account, by its own accessible name. */
function legendCheckbox(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('checkbox', { name: `Show ${name} on the chart` })
}

/**
 * `AccountLegendRow`'s own row — the checkbox, swatch, name and balance
 * together — scoped by its checkbox's accessible name rather than matched
 * page-wide. `AccountLegendRow.vue`'s row is the only element combining
 * exactly these four utility classes, so this stays a single match even
 * though the class selector alone says nothing about *whose* row it is.
 */
function legendRow(page: import('@playwright/test').Page, name: string) {
  return page
    .locator('div.flex.min-h-11.items-center.gap-2')
    .filter({ has: legendCheckbox(page, name) })
}

/**
 * Asserts an element's text equals `expected` without ever printing what it
 * actually said.
 *
 * `toHaveText` prints the *received* string on failure, and on this screen
 * that string is a balance — the same defect as `negative-balances.spec.ts:157`.
 * A literal inside a *selector* is a different matter and stays as it is: it is
 * a constant already committed to this file, and a failure prints the selector
 * rather than anything read back from the running app.
 *
 * `expect.poll` also keeps the auto-retry `toHaveText` gave us, which a bare
 * `textContent()` comparison silently drops.
 */
async function expectTextToBe(locator: import('@playwright/test').Locator, expected: string) {
  await expect.poll(async () => (await locator.textContent())?.trim() === expected).toBe(true)
}

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('the verdict bands', () => {
  test('covered: the badge, the headline and the chart all agree', async ({
    emptyHouseholdPage: page,
  }) => {
    await addAccount(page, 'E2E Covered', '2000')
    await gotoHydrated(page, '/')

    const card = lowestBalanceCard(page)
    await expect(card.locator('[data-slot="badge"]')).toHaveText('Covered')

    const headline = card.locator('span.font-mono').first()
    await expectTextToBe(headline, '$2,000')

    // Compared as a boolean rather than asserted as a string: a failed string
    // comparison here would print the chart's full `aria-label`, which
    // carries the same balance, into the report. `false` never does.
    // Polled, not compared once: this runs right after hydration, and a bare
    // read races the chart's first paint. Still a boolean either way — a
    // failure prints `false`, never the label, which carries the balance.
    const chart = page.getByRole('img', { name: /Balance forecast/ })
    await expect
      .poll(async () => {
        const label = await chart.getAttribute('aria-label')
        const headlineText = await headline.textContent()
        return label !== null && headlineText !== null && label.includes(headlineText)
      })
      .toBe(true)
  })

  test('tight: a margin under $250 gets a warning, not an alert', async ({
    emptyHouseholdPage: page,
  }) => {
    await addAccount(page, 'E2E Tight', '700')
    await gotoHydrated(page, '/')

    const card = lowestBalanceCard(page)
    await expect(card.locator('[data-slot="badge"]')).toHaveText('Tight')
    await expect(card.locator('[data-slot="alert"]')).toHaveCount(0)

    const headline = card.locator('span.font-mono').first()
    await expectTextToBe(headline, '$700')
    await expect(headline).not.toHaveClass(/text-destructive/)
  })

  test('short: the badge names the figure, the alert repeats it, the headline is styled', async ({
    emptyHouseholdPage: page,
  }) => {
    await addAccount(page, 'E2E Short', '100')
    await gotoHydrated(page, '/')

    const card = lowestBalanceCard(page)
    await expectTextToBe(card.locator('[data-slot="badge"]'), 'Short by $500')
    await expect(
      card.getByText(/Projected to dip \$500 below your safety cushion on/),
    ).toBeVisible()

    const headline = card.locator('span.font-mono').first()
    await expectTextToBe(headline, '$100')
    await expect(headline).toHaveClass(/text-destructive/)
  })
})

test.describe('the account selector', () => {
  test('changes the verdict, and never drops the hidden account from the legend', async ({
    emptyHouseholdPage: page,
  }) => {
    await addAccount(page, 'E2E Selector Combined', '2000')
    await addAccount(page, 'E2E Selector Short', '100')
    await gotoHydrated(page, '/')

    const card = lowestBalanceCard(page)
    const badge = card.locator('[data-slot="badge"]')
    await expect(badge).toHaveText('Covered')

    const combinedCheckbox = legendCheckbox(page, 'E2E Selector Combined')
    await clickUntil(combinedCheckbox, card.getByText('Short by $500', { exact: true }))
    await expectTextToBe(badge, 'Short by $500')

    const headline = card.locator('span.font-mono').first()
    await expectTextToBe(headline, '$100')

    // Deselected, not gone: `docs/design/dashboard/screens/single-account.png`
    // specifies the legend keeps every account's own figure regardless of
    // whether its line is drawn — that is the entire reason `index.vue` reads
    // the legend from `legendProjection`, a projection over every account,
    // rather than from the narrowed one the chart itself uses. Scoped to the
    // hidden account's own legend row, not matched page-wide: a page-wide
    // `$2,000` proves the string is somewhere, not that it is *this*
    // account's figure in *this* row.
    await expect(
      legendRow(page, 'E2E Selector Combined').getByText('$2,000', { exact: true }),
    ).toBeVisible()

    await clickUntil(combinedCheckbox, card.getByText('Covered', { exact: true }))
    await expect(badge).toHaveText('Covered')
  })

  test("the last visible account's checkbox is disabled, not just rejected on click", async ({
    emptyHouseholdPage: page,
  }) => {
    await addAccount(page, 'E2E Only Account', '2000')
    await gotoHydrated(page, '/')

    await expect(legendCheckbox(page, 'E2E Only Account')).toBeDisabled()
  })

  test('survives a reload', async ({ emptyHouseholdPage: page }) => {
    await addAccount(page, 'E2E Persist Combined', '2000')
    await addAccount(page, 'E2E Persist Short', '100')
    await gotoHydrated(page, '/')

    const card = lowestBalanceCard(page)
    const combinedCheckbox = legendCheckbox(page, 'E2E Persist Combined')
    await clickUntil(combinedCheckbox, card.getByText('Short by $500', { exact: true }))

    await gotoHydrated(page, '/')

    await expect(legendCheckbox(page, 'E2E Persist Combined')).not.toBeChecked()
    await expectTextToBe(lowestBalanceCard(page).locator('[data-slot="badge"]'), 'Short by $500')
  })
})

test.describe('the forecast horizon', () => {
  test('survives a reload, in both cards that read it', async ({ emptyHouseholdPage: page }) => {
    await addAccount(page, 'E2E Horizon Persist', '1000')
    await gotoHydrated(page, '/')

    const group = page.getByRole('group', { name: 'Forecast horizon' })
    const ninety = group.getByRole('button', { name: '90d' })
    await clickUntil(ninety, group.locator('[aria-pressed="true"]').filter({ hasText: '90d' }))
    await expect(ninety).toHaveAttribute('aria-pressed', 'true')

    await gotoHydrated(page, '/')

    const groupAfterReload = page.getByRole('group', { name: 'Forecast horizon' })
    await expect(groupAfterReload.getByRole('button', { name: '90d' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByText(`14 days back ${MIDDOT} 90 days ahead`)).toBeVisible()
    await expect(page.getByText(/through 90 days/)).toBeVisible()
  })
})

test.describe('the short household', () => {
  test('is short, on the dashboard, without a single write', async ({
    shortHouseholdPage: page,
  }) => {
    await gotoHydrated(page, '/')

    const card = lowestBalanceCard(page)
    // Compared as a boolean rather than asserted with `toHaveText` against a
    // pattern, the same idiom `dashboard.spec.ts`'s horizon test and
    // `recurring-items.spec.ts`'s negative-forecast test use: this badge
    // carries C's real shortfall figure, and a failed pattern assertion
    // prints the received text into the log — a balance CLAUDE.md does not
    // allow there, and this fixture is read-only besides.
    const badge = card.locator('[data-slot="badge"]')
    await expect
      .poll(async () => (await badge.textContent())?.trim().startsWith('Short by ') ?? false, {
        message: 'the badge did not read "Short by …"',
      })
      .toBe(true)
    await expect(card.locator('[data-slot="alert"]')).toBeVisible()
  })
})
