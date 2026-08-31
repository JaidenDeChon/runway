/**
 * Regression test for an adversarial-review finding: session-local recurring
 * items (and transfers, which share the same state) survived a user switch.
 *
 * `useRunwayData.ts`'s household `useAsyncData` re-fetches on
 * `watch: [authUser]`, but `localRecords` — the `useState` backing
 * `recurringItems` and `transfers`, still session-local per CLAUDE.md pending
 * issues #8/#9 — had no such watch. Sign-out and sign-in are both
 * *client-side* navigations, not full page reloads, so the stale `useState`
 * lived on into the next signed-in user's session.
 *
 * Reproduced by hand before the fix: as user A, add "LEAKPROBE Rent"; sign
 * out; sign in as user D; `/accounts` correctly showed "No accounts yet"
 * (Supabase-backed, re-fetched on the user change) while `/recurring-items`
 * still rendered A's row (session-local, never reset).
 *
 * This drives the exact same sequence through the real UI — sign-out and
 * sign-in are user actions, driven with no `page.goto` anywhere in between. A
 * full reload at any point would start the client runtime over from nothing
 * and pass whether or not the fix exists; only staying on one continuous
 * client-side session exercises the stale `useState` the bug lived in.
 */

import { USER_D } from '../support/database'
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

test('clears session-local recurring items when a different user signs in', async ({
  authenticatedPage: page,
}) => {
  // ── as user A: add a recurring item that lives only in useState ──────────
  await gotoHydrated(page, '/recurring-items')

  const dialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('button', { name: 'Add recurring item' }), dialog)
  await page.locator('#recurring-name').fill('LEAKPROBE Rent')

  const row = page.getByRole('button', { name: 'Edit LEAKPROBE Rent' })
  await clickUntil(dialog.getByRole('button', { name: 'Add recurring item' }), row)
  await expect(row).toBeVisible()

  // ── sign out, in the browser, same page/tab ───────────────────────────────
  // The user menu lives in the sidebar on every page, so this needs no
  // navigation away from `/recurring-items` first — and no navigation means
  // no chance of a full reload sneaking in and discarding the in-memory
  // `useState` on its own, which would make this pass regardless of the fix.
  await openUserMenu(page)
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/sign-in/)

  // ── sign in as a different user, same page/tab ────────────────────────────
  await page.getByLabel('Email').first().fill(USER_D.email)
  await signInPassword(page).fill(USER_D.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Signing out from `/recurring-items` round-trips a `?redirect=` back to
  // it (the same "remember where they were going" behaviour
  // authentication.spec.ts covers for an unauthenticated visit), so sign-in
  // may land straight back there rather than on `/`. Either is fine — this
  // test only cares about the final state.
  await expect(page).not.toHaveURL(/\/sign-in/)

  // ── user A's session-local item must not be on user D's screen ───────────
  // A sidebar link, not `gotoHydrated`, if a hop is even needed: the bug was
  // specifically that a client-side navigation after a client-side sign-in
  // left the stale `useState` on screen, so a full page reload here would not
  // exercise it.
  if (!/\/recurring-items/.test(page.url())) await gotoViaNavLink(page, 'Recurring Items')
  await expect(page).toHaveURL(/\/recurring-items/)
  await expect(page.getByRole('button', { name: 'Edit LEAKPROBE Rent' })).toHaveCount(0)
  await expect(page.getByText('No recurring bills or income yet')).toBeVisible()
})
