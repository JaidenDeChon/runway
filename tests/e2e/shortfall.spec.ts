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

/**
 * Sets the safety cushion through the real UI — the "Safety cushion" card on
 * `/accounts`, not `/will-i-make-it`, which only displays the stored figure.
 * See `SafetyCushionCard.vue`'s doc comment for why the cushion is edited
 * there now.
 */
async function setCushion(page: import('@playwright/test').Page, amount: string): Promise<void> {
  await gotoHydrated(page, '/accounts')
  await page.locator('#account-cushion').fill(amount)
  await clickUntil(page.locator('#cushion-save'), page.getByText('Saved.'))
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

test('covered through the target still warns when the cushion breaks later in the horizon', async ({
  emptyHouseholdPage: page,
}) => {
  // The household's monthly $500 bill keeps landing after the selected
  // target (one month out, Covered per the test above): by three months out
  // the running balance is $500, below D's $600 cushion — well inside the
  // 180-day outlook horizon. `shortfallOutlook` is what notices that a
  // target-scoped Covered verdict says nothing about the rest of the
  // horizon; this is its one E2E check. Asserted on the stable phrase alone,
  // not the breach date, which depends on the run's real calendar month and
  // would otherwise make this file compute its own date arithmetic.
  await buildHousehold(page)
  await gotoHydrated(page, '/will-i-make-it')

  await expectTextToBe(verdictBadge(page), 'Covered')
  await expect(
    verdictCard(page).getByText(/Look further out, though: your cushion breaks on/),
  ).toBeVisible()
})

test('a cushion above today\'s balance never recovers, and the note says so rather than "every target starts short"', async ({
  emptyHouseholdPage: page,
}) => {
  // D's household has no income at all, so once the cushion is set above
  // today's $2,000 balance the running balance never climbs back over it —
  // `shortfallOutlook.recoversOn` stays null for the whole 180-day horizon,
  // which is the "persistent" branch of the below-cushion-today note. Asserted
  // on the stable phrase, not the horizon length or a rendered balance.
  await buildHousehold(page)
  await setCushion(page, '3000')
  await gotoHydrated(page, '/will-i-make-it')

  await expectTextToBe(verdictBadge(page), 'Short')
  await expect(
    verdictCard(page).getByText(/You stay below your cushion for the whole of the next/),
  ).toBeVisible()
})

test('a bigger cushion flips the same projection to short, and the projection does not move', async ({
  emptyHouseholdPage: page,
}) => {
  await buildHousehold(page)
  await setCushion(page, '2000')
  await gotoHydrated(page, '/will-i-make-it')

  await expectTextToBe(verdictBadge(page), 'Short')
  await expectTextToBe(verdictHeadline(page), 'You need $500 more.')

  // The cushion changed the verdict; it must not have moved the projection.
  const figures = statFigures(page)
  await expectTextToBe(figures.nth(0), '$2,000')
  await expectTextToBe(figures.nth(1), '$1,500')
})

test('the cushion survives a full reload, and the verdict it drives is correct on a fresh page load', async ({
  emptyHouseholdPage: page,
}) => {
  await buildHousehold(page)
  await setCushion(page, '2000')

  // A fresh navigation re-fetches from Supabase, so this asserts the stored
  // row rather than an in-memory overlay `setCushion` left behind on
  // `/accounts` — `gotoHydrated` is always a real `page.goto()`, a full
  // server round-trip, never a client-side transition.
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

test('a failed cushion save shows an error and leaves the typed draft on screen', async ({
  emptyHouseholdPage: page,
}) => {
  // Regression for the class of bug PR #79 review finding #3 and the later
  // navigation-breaking bug both belonged to: a write that fails must never
  // silently snap the field back to the old stored value, or corrupt
  // anything a still-open page is showing. The debounced-keystroke race
  // those findings were about cannot happen through this UI any more — the
  // Save button below is disabled for the whole time a call is in flight
  // (`SafetyCushionCard.vue`), so there is no way to have two overlapping
  // calls to race in the first place.
  await buildHousehold(page)
  await gotoHydrated(page, '/accounts')

  // Only the write (POST, via `upsert`) is meant to fail — the household's
  // own reads of `user_settings` share this same REST path and must pass
  // through untouched, or the page never finishes loading.
  await page.route('**/rest/v1/user_settings*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.continue()
      return
    }
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })

  await page.locator('#account-cushion').fill('2000')
  await page.locator('#cushion-save').click()

  await expect(
    page.getByText('Could not save that amount. Check your connection and try again.'),
  ).toBeVisible()
  await expect(page.locator('#account-cushion')).toHaveValue('2000')
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
