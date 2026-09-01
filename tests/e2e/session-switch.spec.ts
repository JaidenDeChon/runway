/**
 * Regression test for an adversarial-review finding: session-local recurring
 * items (and transfers, which share the same state) survived a user switch.
 *
 * **Issue #8 moved recurring items onto Supabase, which changes what this
 * test can prove.** The original bug was that `localRecords` — the `useState`
 * backing `recurringItems`, session-local per CLAUDE.md at the time — had no
 * `watch` on the signed-in user, so a client-side sign-out/sign-in (no full
 * reload) left the previous user's item on screen. Recurring items are now
 * fetched by the same `useAsyncData` that already re-runs on
 * `watch: [authUser]` for accounts, so that specific leak is closed by
 * construction rather than by a watch this file can still exercise in
 * isolation — recurringItems no longer has a separate `useState` to leave
 * stale.
 *
 * What is left to prove, and what this file proves instead: that switching
 * sessions client-side actually re-fetches the **new** user's own rows,
 * rather than merely leaving an empty list on screen for a reason that would
 * look identical whether or not the fetch re-ran. Creating under user D
 * (whose household is wiped before and after by `emptyHouseholdSession`) and
 * switching to user B — who has real seeded recurring items of their own —
 * makes that distinguishable: if the switch failed to re-fetch, B would see
 * either D's leaked row or nothing at all, never B's own "B Rent".
 *
 * Transfers still share the old `localRecords` shape (issue #9 owns moving
 * them), so the watch this test originally guarded still exists in
 * `useRunwayData.ts` — it is just no longer this file's concern.
 *
 * Driven with no `page.goto` between sign-out and sign-in — sign-out and
 * sign-in are user actions in one continuous client-side session, which is
 * what would have hidden the original bug behind a full reload.
 */

import { USER_B } from '../support/database'
import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

/** See the identical helper in authentication.spec.ts for why this is needed. */
async function openUserMenu(page: import('@playwright/test').Page): Promise<void> {
  const trigger = page.getByRole('button', { name: /@runway\.test/ }).first()
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click()
  }
  await trigger.click()
}

/** See the identical helper in authentication.spec.ts for why "Password" alone is ambiguous. */
function signInPassword(page: import('@playwright/test').Page) {
  return page.getByRole('tabpanel').getByLabel('Password')
}

/**
 * Follows a sidebar nav link, opening the mobile sheet first if it is not
 * already on screen — the same on-demand-open shape `openUserMenu` uses
 * above, for the same reason (the 375px project keeps the sidebar in a
 * closed overlay Sheet).
 */
async function gotoViaNavLink(page: import('@playwright/test').Page, name: string): Promise<void> {
  const link = page.getByRole('link', { name, exact: true })
  if (!(await link.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click()
  }
  await link.click()
}

test("re-fetches the new user's own recurring items on a client-side session switch", async ({
  emptyHouseholdPage: page,
}) => {
  // ── as user D: an account first — a rule needs one to belong to, and D's
  // household starts with none. ──────────────────────────────────────────
  await gotoHydrated(page, '/accounts')
  const accountDialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('button', { name: 'Add account' }), accountDialog)
  await page.locator('#account-name').fill('LEAKPROBE Checking')
  await page.locator('#account-balance').fill('500')
  const accountRow = page.getByRole('button', { name: 'Edit LEAKPROBE Checking' })
  await clickUntil(accountDialog.getByRole('button', { name: 'Add account' }), accountRow)
  await expect(accountRow).toBeVisible()

  // ── create a real recurring-item row (persisted, unlike the old useState) ─
  // A `gotoHydrated` reload here, not `gotoViaNavLink`: this transition is
  // before the sign-out/sign-in this test actually cares about, so there is
  // no risk of a reload masking the thing under test — unlike the later hop,
  // where a client-side link is the only thing that exercises it.
  await gotoHydrated(page, '/recurring-items')

  const dialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('button', { name: 'Add recurring item' }), dialog)
  await page.locator('#recurring-name').fill('LEAKPROBE Rent')
  // A positive amount: recurring_rules.amount_cents has a > 0 check
  // constraint, and the blank-form default of 0 would fail to save.
  await page.locator('#recurring-amount').fill('50')

  const row = page.getByRole('button', { name: 'Edit LEAKPROBE Rent' })
  await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)
  await expect(row).toBeVisible()

  // ── sign out, in the browser, same page/tab ───────────────────────────────
  // The user menu lives in the sidebar on every page, so this needs no
  // navigation away from `/recurring-items` first — and no navigation means
  // no chance of a full reload sneaking in and forcing a re-fetch on its own,
  // which would make this pass whether or not the switch itself re-fetches.
  await openUserMenu(page)
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/sign-in/)

  // ── sign in as user B, same page/tab ──────────────────────────────────────
  // B, not D again: B has real seeded recurring items of their own ("B Rent"),
  // so seeing them is a positive assertion that the fetch actually re-ran for
  // the new user — not merely that the screen went blank, which an empty
  // list and a failed re-fetch would look identical to.
  await page.getByLabel('Email').first().fill(USER_B.email)
  await signInPassword(page).fill(USER_B.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Signing out from `/recurring-items` round-trips a `?redirect=` back to
  // it (the same "remember where they were going" behaviour
  // authentication.spec.ts covers for an unauthenticated visit), so sign-in
  // may land straight back there rather than on `/`. Either is fine — this
  // test only cares about the final state.
  await expect(page).not.toHaveURL(/\/sign-in/)

  // ── user B's screen shows B's own rows, not D's and not nothing ──────────
  // A sidebar link, not `gotoHydrated`, if a hop is even needed: the point is
  // that a client-side navigation after a client-side sign-in shows the
  // signed-in user's own data, so a full page reload here would not exercise
  // that the switch reset the underlying async data.
  if (!/\/recurring-items/.test(page.url())) await gotoViaNavLink(page, 'Recurring Items')
  await expect(page).toHaveURL(/\/recurring-items/)
  await expect(page.getByRole('button', { name: 'Edit LEAKPROBE Rent' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit B Rent' })).toBeVisible()
})
