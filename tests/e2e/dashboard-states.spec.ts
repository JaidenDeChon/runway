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

import {
  assertBaseUrlIsLocal,
  clickUntil,
  expect,
  expectTextToBe,
  gotoHydrated,
  test,
} from './fixtures'

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

/** `LowestBalanceCard`'s meta line — "<date> · <days away>". Date and cadence only; no money. */
function lowestMeta(page: import('@playwright/test').Page) {
  return lowestBalanceCard(page).locator('p.mt-1.text-sm.text-muted-foreground')
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
    await expectTextToBe(card.locator('[data-slot="badge"]'), 'Covered')

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
    await expectTextToBe(card.locator('[data-slot="badge"]'), 'Tight')
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
    await expectTextToBe(badge, 'Covered')

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
    await expectTextToBe(badge, 'Covered')
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

test.describe('everyday spending', () => {
  test('a monthly figure bends the forecast, and zero flattens it again', async ({
    emptyHouseholdPage: page,
  }) => {
    // The first account, so `AccountEditor`'s watcher defaults
    // `isDiscretionarySource` on — the drain then has somewhere to come from.
    await addAccount(page, 'E2E Everyday', '2000')
    await gotoHydrated(page, '/accounts')
    await expect(page.getByText('Discretionary source')).toBeVisible()

    // Baseline: no drain, so the line is flat and its running minimum is the
    // earliest qualifying day — `verdictFrom` is today + 1, and the engine's
    // strict `<` keeps the earliest date on a tie.
    await gotoHydrated(page, '/')
    await expect
      .poll(
        async () =>
          (await lowestMeta(page).textContent())?.trim().endsWith(`${MIDDOT} in 1 day`) ?? false,
      )
      .toBe(true)

    // Captured, never asserted as a figure: only ever compared to a later
    // reading of the same element and only ever reported as `false`.
    const headline = lowestBalanceCard(page).locator('span.font-mono').first()
    const before = (await headline.textContent())?.trim() ?? ''

    await gotoHydrated(page, '/accounts')
    await page.locator('#discretionary-monthly').fill('300')
    await clickUntil(page.locator('#discretionary-save'), page.getByText('Saved.'))

    // A full reload — this asserts the stored row, not the in-memory overlay.
    // With any positive drain the line falls strictly every day, so its
    // minimum is uniquely the last day of D's stored 30-day horizon.
    await gotoHydrated(page, '/')
    await expect
      .poll(
        async () =>
          (await lowestMeta(page).textContent())?.trim().endsWith(`${MIDDOT} in 30 days`) ?? false,
      )
      .toBe(true)
    await expect
      .poll(async () => ((await headline.textContent())?.trim() ?? '') !== before)
      .toBe(true)

    // Zero it: a strict round trip. A drain that is merely smaller, or an
    // overlay that never cleared, fails both halves.
    await gotoHydrated(page, '/accounts')
    await page.locator('#discretionary-monthly').fill('0')
    await clickUntil(page.locator('#discretionary-save'), page.getByText('Saved.'))

    await gotoHydrated(page, '/')
    await expect
      .poll(
        async () =>
          (await lowestMeta(page).textContent())?.trim().endsWith(`${MIDDOT} in 1 day`) ?? false,
      )
      .toBe(true)
    await expect
      .poll(async () => ((await headline.textContent())?.trim() ?? '') === before)
      .toBe(true)
  })

  test('a failed save shows an error and leaves the typed draft on screen', async ({
    emptyHouseholdPage: page,
  }) => {
    // Regression: `setMonthlyDiscretionarySpend` writes its optimistic value
    // into the same computed the card resyncs from, and rolls that overlay
    // straight back to the old stored value on a failed write — both before
    // `onSave`'s own `catch` runs. Without a guard, the card's resync watcher
    // treats that rollback as an external change and silently snaps the
    // field back, hiding the error and destroying what was typed. Same bug,
    // same fix, as `SafetyCushionCard.vue`'s version of this card — see its
    // own test in `tests/e2e/shortfall.spec.ts`.
    await addAccount(page, 'E2E Everyday Fail', '2000')
    await gotoHydrated(page, '/accounts')

    await page.route('**/rest/v1/user_settings*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    })

    await page.locator('#discretionary-monthly').fill('300')
    await page.locator('#discretionary-save').click()

    await expect(
      page.getByText('Could not save that amount. Check your connection and try again.'),
    ).toBeVisible()
    await expect(page.locator('#discretionary-monthly')).toHaveValue('300')
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
