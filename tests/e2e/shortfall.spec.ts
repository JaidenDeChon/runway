/**
 * "Will I make it?"'s answerable path, end to end — the counterpart to
 * `shortfall-empty-states.spec.ts`, which covers the two states where the
 * screen refuses to answer at all.
 *
 * Runs on `emptyHouseholdPage` (user D), never A or C:
 * `tests/rls/seed-fidelity.test.ts` holds A and C to `domain/seed.ts` exactly,
 * including their `cushion_cents`, so a test writing to either breaks a
 * different suite. D is reset before and after each test by the fixture
 * (`resetEmptyHousehold` in `./fixtures`, which now restores `cushion_cents`
 * too — see that function's doc comment for why this suite would otherwise
 * break `dashboard-states.spec.ts`'s exact-band assertions).
 *
 * **The household, and why its figures are exact.** One account at $2,000 and
 * one recurring bill at $500, left on the editor's defaults (kind bill,
 * cadence monthly, next occurrence = *today*). D's
 * `monthly_discretionary_cents` is 0 after the reset, so the balance line is
 * flat apart from that one bill. The engine treats an occurrence dated on the
 * account's `balanceAsOf` as already inside that reading, so today's balance
 * is exactly $2,000; `upcomingBills` starts at today+1, so the one listed
 * bill is the occurrence one month out; and the window `[today, that date]`
 * contains exactly that one occurrence. Therefore **Today $2,000, Lowest
 * point $1,500**, with no date arithmetic anywhere in this file.
 *
 * Each test rebuilds the household from scratch, because `emptyHouseholdPage`
 * resets it per test (not per file) — the same reason `dashboard-states.spec.ts`
 * and `shortfall-empty-states.spec.ts` both call their own `addAccount` in
 * every test rather than once in a `beforeAll`.
 */

import {
  assertBaseUrlIsLocal,
  clickUntil,
  expect,
  expectTextToBe,
  gotoHydrated,
  test,
} from './fixtures'

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

/**
 * One account at $2,000, one bill at $500 due one month out (kind, cadence
 * and next-occurrence all left on the editor's defaults). See the file
 * comment for why these particular figures make Today $2,000 and Lowest
 * point $1,500 exact, not just approximate.
 */
async function buildHousehold(page: import('@playwright/test').Page): Promise<void> {
  await addAccount(page, 'E2E Checking', '2000')

  await gotoHydrated(page, '/recurring-items')
  const dialog = page.getByRole('dialog')
  const addTrigger = page
    .getByRole('button', { name: 'Add recurring item' })
    .filter({ visible: true })
    .first()
  await clickUntil(addTrigger, dialog)
  await dialog.locator('#recurring-name').fill('E2E Rent')
  await dialog.locator('#recurring-amount').fill('500')
  const itemRow = page.getByText('E2E Rent', { exact: true })
  await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), itemRow)
  await expect(itemRow).toBeVisible()
}

/** `VerdictCard`, scoped by its own "Lowest point" stat rather than by position on the page. */
function verdictCard(page: import('@playwright/test').Page) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText('Lowest point', { exact: true }) })
}

function verdictBadge(page: import('@playwright/test').Page) {
  return verdictCard(page).locator('[data-slot="badge"]')
}

function verdictHeadline(page: import('@playwright/test').Page) {
  return verdictCard(page).locator('h2')
}

/**
 * `MoneyText` renders `font-mono tabular-nums`; the "On" date span is
 * `font-mono` only, so this excludes it. In DOM order: `.nth(0)` is Today,
 * `.nth(1)` is Lowest point.
 */
function statFigures(page: import('@playwright/test').Page) {
  return verdictCard(page).locator('span.font-mono.tabular-nums')
}

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test('selects a bill and answers with the low point, not the endpoint', async ({
  emptyHouseholdPage: page,
}) => {
  await buildHousehold(page)
  await gotoHydrated(page, '/will-i-make-it')

  await expect(page.getByRole('radio', { name: /E2E Rent/ })).toBeChecked()
  await expectTextToBe(verdictBadge(page), 'Covered')

  const figures = statFigures(page)
  await expectTextToBe(figures.nth(0), '$2,000')
  await expectTextToBe(figures.nth(1), '$1,500')

  // D's stored $600 cushion against a $1,500 low leaves $900 to spare.
  await expect(verdictCard(page).getByText(/\$900 to spare/)).toBeVisible()
})

test('a bigger cushion flips the same projection to short, and the projection does not move', async ({
  emptyHouseholdPage: page,
}) => {
  await buildHousehold(page)
  await gotoHydrated(page, '/will-i-make-it')

  await page.locator('#shortfall-cushion').fill('2000')

  await expectTextToBe(verdictBadge(page), 'Short')
  await expectTextToBe(verdictHeadline(page), 'You need $500 more.')

  // The cushion changed the verdict; it must not have moved the projection.
  const figures = statFigures(page)
  await expectTextToBe(figures.nth(0), '$2,000')
  await expectTextToBe(figures.nth(1), '$1,500')
})

test('the cushion survives a full reload', async ({ emptyHouseholdPage: page }) => {
  await buildHousehold(page)
  await gotoHydrated(page, '/will-i-make-it')

  // Registered before the fill, not after: the write is debounced 400ms
  // behind the keystroke, and by the time `expectTextToBe` below resolves
  // that debounce may already have fired. Waiting on the actual network
  // response — rather than a fixed sleep guessing at the timing — is what
  // `gotoHydrated`'s own doc comment calls a reactive gate over a timing one.
  const cushionSaved = page.waitForResponse(
    (response) => response.url().includes('/rest/v1/user_settings') && response.ok(),
  )
  await page.locator('#shortfall-cushion').fill('2000')
  await expectTextToBe(verdictBadge(page), 'Short')
  await cushionSaved

  // A reload re-fetches from Supabase, so this asserts the stored row and not
  // the in-memory overlay. Asserted on the verdict, not the input's own
  // formatting, so this does not encode `MoneyInput`'s draft rendering.
  const response = await gotoHydrated(page, '/will-i-make-it')

  await expectTextToBe(verdictBadge(page), 'Short')
  await expectTextToBe(verdictHeadline(page), 'You need $500 more.')

  // The two assertions above already pass even when the *server-rendered*
  // verdict is wrong: hydration reseeds the page from the payload and
  // repaints over it. Reading the response body — the bytes the server
  // actually sent, before any client JS ran — is the only way to catch a
  // page-level ref seeded from the household fetch's not-yet-resolved
  // default instead of the real cushion. Reduced to booleans, never the raw
  // body, so a failure never puts a rendered balance in the assertion
  // message or CI output.
  const ssr = (await response?.text()) ?? ''
  expect(/You need \$500 more\./.test(ssr)).toBe(true)
  expect(/to spare above your cushion/.test(ssr)).toBe(false)
})

test('carries the target in the URL, and a mode round-trip restores rather than resets it', async ({
  emptyHouseholdPage: page,
}) => {
  await buildHousehold(page)
  await gotoHydrated(page, '/will-i-make-it')

  const billTab = page.getByRole('tab', { name: 'Upcoming bill' })
  const dateTab = page.getByRole('tab', { name: 'Pick a date' })

  await expect(page.getByRole('radio', { name: /E2E Rent/ })).toBeChecked()
  // Bill mode has nothing in the URL yet — nothing has written it there.
  // `mode`/`billId` resolve from an empty query on first load; only a tab
  // click or a selection round-trips through the router.
  expect(new URL(page.url()).searchParams.get('bill')).toBeNull()

  await dateTab.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('date')
  const defaultDate = await page.locator('#shortfall-date').inputValue()

  // Regression guard for issue #14's spec.md:120 ("switching back restores
  // the previously selected bill, and the date keeps its value"): `setMode`
  // used to write only `mode` plus the destination mode's own key, dropping
  // the other one. Switching back to bill mode here must not drop the `on`
  // this date tab just wrote — the first place the old code lost it.
  await billTab.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('bill')
  const billId = new URL(page.url()).searchParams.get('bill')
  expect(billId).not.toBeNull()
  expect(new URL(page.url()).searchParams.get('on')).toBe(defaultDate)
  await expect(page.getByRole('radio', { name: /E2E Rent/ })).toBeChecked()

  // Now type a date distinct from the tab switch's own default, so a reset
  // back to that default is distinguishable from a real restore. UTC
  // arithmetic on the ISO string, not a domain import — this file stays
  // free of its own date math per the file comment.
  await dateTab.click()
  const picked = new Date(`${defaultDate}T00:00:00Z`)
  picked.setUTCDate(picked.getUTCDate() + 5)
  const customDate = picked.toISOString().slice(0, 10)
  await page.locator('#shortfall-date').fill(customDate)
  await expect.poll(() => new URL(page.url()).searchParams.get('on')).toBe(customDate)

  // Second round trip, the other direction: bill mode must not drop the
  // freshly typed date either, and must still restore the same bill.
  await billTab.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('bill')
  expect(new URL(page.url()).searchParams.get('bill')).toBe(billId)
  expect(new URL(page.url()).searchParams.get('on')).toBe(customDate)
  await expect(page.getByRole('radio', { name: /E2E Rent/ })).toBeChecked()

  await dateTab.click()
  await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('date')
  expect(new URL(page.url()).searchParams.get('on')).toBe(customDate)
  await expect(page.locator('#shortfall-date')).toHaveValue(customDate)

  const url = new URL(page.url())
  expect(url.pathname).toBe('/will-i-make-it')
  // Carrying both modes' keys at once is the deliberate cost of restoring
  // rather than resetting; nothing beyond the three owned keys ever appears,
  // and in particular no amount does. A uuid or a calendar day in a failure
  // message is fine per CLAUDE.md; a balance is not.
  expect([...url.searchParams.keys()].sort()).toEqual(['bill', 'mode', 'on'])
  expect(url.search).not.toContain('$')
})

test('a stale or malformed deep link falls back instead of erroring', async ({
  emptyHouseholdPage: page,
}) => {
  await buildHousehold(page)
  await gotoHydrated(page, '/will-i-make-it')

  // Read the default date, never computed: this keeps the test free of
  // timezone arithmetic of its own.
  await page.getByRole('tab', { name: 'Pick a date' }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('mode')).toBe('date')
  const defaultDate = await page.locator('#shortfall-date').inputValue()

  await gotoHydrated(page, '/will-i-make-it?mode=nope&on=2020-01-01&bill=not-a-bill')

  await expect(page.getByText('Lowest point', { exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Upcoming bill' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  await page.getByRole('tab', { name: 'Pick a date' }).click()
  await expect(page.locator('#shortfall-date')).toHaveValue(defaultDate)

  await gotoHydrated(page, `/will-i-make-it?mode=date&on=${defaultDate}`)
  await expect(page.getByRole('tab', { name: 'Pick a date' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('#shortfall-date')).toHaveValue(defaultDate)
})
