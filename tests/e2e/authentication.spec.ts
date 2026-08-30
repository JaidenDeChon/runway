/**
 * The authentication lifecycle, end to end.
 *
 * Issue #6's acceptance criteria, one test each:
 *
 * - sign up → sign in → protected route → sign out,
 * - unauthenticated access to any app route redirects to sign-in,
 * - an expired session redirects rather than erroring,
 * - a forged `user_id` in a request reaches nobody else's data.
 *
 * Everything here drives the **real** app against the **real** local GoTrue.
 * Accounts created by the sign-up test are torn down afterwards over the admin
 * connection — the one place in this suite that uses it, and only to clean up.
 *
 * No password, token or balance is ever asserted on by value, and none is
 * interpolated into a failure message. Playwright traces do capture rendered
 * pages, which is why they are failure-only CI artifacts.
 */

import { adminSql, LOCAL_STACK, USER_A, USER_B } from '../support/database'
import {
  assertBaseUrlIsLocal,
  expect,
  gotoHydrated,
  mintBrowserSession,
  requireStackOrSkip,
  test,
} from './fixtures'

/** Local-only fixture credentials, worth nothing off this machine. */
const THROWAWAY_PASSWORD = 'runway-local-e2e-pw'

const createdUserIds: string[] = []

function throwawayEmail(): string {
  const unique = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  return `fixture-e2e-${unique}@runway.test`
}

/**
 * Open the user menu, whichever viewport this is running in.
 *
 * On the 375px project the sidebar is an overlay Sheet that starts closed, so
 * the menu trigger is not on screen until the sidebar is opened. Both
 * Playwright projects run every spec, and a test that only worked on the
 * desktop one would quietly stop covering the width `CLAUDE.md` says the app is
 * built at first.
 *
 * The trigger is matched on the email it renders — every fixture account is
 * `@runway.test` — because the button's accessible name is deliberately the
 * name and address rather than a label that would hide them from a screen
 * reader.
 */
async function openUserMenu(page: import('@playwright/test').Page): Promise<void> {
  const trigger = page.getByRole('button', { name: /@runway\.test/ }).first()
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click()
  }
  await trigger.click()
}

/**
 * The password field on the sign-in page.
 *
 * `getByLabel('Password')` is ambiguous there, and correctly so: the tab is
 * called "Password" and so is the field inside it, and Reka names the tabpanel
 * after its trigger. Both are right; the locator has to say which one it means.
 * Scoping to the panel keeps this role-based rather than reaching for an id.
 */
function signInPassword(page: import('@playwright/test').Page) {
  return page.getByRole('tabpanel').getByLabel('Password')
}

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
  requireStackOrSkip()
})

test.afterAll(async () => {
  if (!LOCAL_STACK || createdUserIds.length === 0) return
  const ids = createdUserIds.splice(0, createdUserIds.length)
  const sql = adminSql()
  try {
    // Cascades to every domain row the account owned, user_settings included.
    await sql`delete from auth.users where id = any(${ids})`
  } finally {
    await sql.end()
  }
})

test.describe('the sign-in door', () => {
  test('sends an unauthenticated visitor to sign-in, remembering where they were going', async ({
    page,
  }) => {
    await gotoHydrated(page, '/accounts')

    // `/accounts`, not `%2Faccounts`: vue-router leaves a slash unencoded in a
    // query value. Both are accepted here so the test is about the round trip
    // rather than about one router version's encoding taste.
    await expect(page).toHaveURL(/\/sign-in\?redirect=(%2F|\/)accounts/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  // Every route in the app, not just the one somebody remembered to test.
  for (const path of [
    '/',
    '/accounts',
    '/recurring-items',
    '/transfers',
    '/will-i-make-it',
    '/first-run',
  ]) {
    test(`refuses ${path} without a session`, async ({ page }) => {
      await gotoHydrated(page, path)
      await expect(page).toHaveURL(/\/sign-in/)
    })
  }

  test('lets a signed-in visitor past the sign-in page rather than stranding them', async ({
    authenticatedPage,
  }) => {
    await gotoHydrated(authenticatedPage, '/sign-in')
    await expect(authenticatedPage).toHaveURL(/\/$|\/\?/)
  })

  test('says nothing about whether an email is registered', async ({ page }) => {
    await gotoHydrated(page, '/sign-in')

    // A seeded address that definitely exists, with the wrong password.
    await page.getByLabel('Email').first().fill(USER_A.email)
    await signInPassword(page).fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    const registered = (await alert.textContent()) ?? ''

    // An address that definitely does not.
    await page.getByLabel('Email').first().fill('nobody-here@runway.test')
    await signInPassword(page).fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(alert).toBeVisible()
    const unregistered = (await alert.textContent()) ?? ''

    // The property, stated directly: the two are indistinguishable.
    expect(unregistered).toBe(registered)
    expect(registered).not.toMatch(/registered|exists|not found|no account/i)
  })
})

test.describe('the full lifecycle', () => {
  test('signs up, signs in, reaches a protected route, and signs out', async ({ page }) => {
    const email = throwawayEmail()

    // ── sign up ──────────────────────────────────────────────────────────────
    await gotoHydrated(page, '/sign-up')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(THROWAWAY_PASSWORD)
    await page.getByLabel('Confirm password').fill(THROWAWAY_PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()

    // The local stack runs with `enable_confirmations = false`, so sign-up
    // returns a live session and lands in the app. A project with confirmations
    // on would stop at "check your inbox" instead — handled in
    // `useAuthActions().signUp`, and out of this test's reach without a mailbox.
    await expect(page).toHaveURL(/\/$|\/\?/)

    // Record for teardown, from the server's answer rather than by parsing
    // anything on the page.
    const created = (await (await page.request.get('/api/auth/session')).json()) as {
      user: { id: string; email: string } | null
    }
    expect(created.user?.email).toBe(email)
    if (created.user) createdUserIds.push(created.user.id)

    // The new account has its settings row, created by the trigger rather than
    // by anything the browser did.
    const settings = await page.request.get('/api/user-settings')
    expect(settings.status()).toBe(200)
    expect(((await settings.json()) as { settings: unknown }).settings).not.toBeNull()

    // ── sign out ─────────────────────────────────────────────────────────────
    await gotoHydrated(page, '/')
    await openUserMenu(page)
    await page.getByRole('menuitem', { name: 'Log out' }).click()

    await expect(page).toHaveURL(/\/sign-in/)

    // Signed out means signed out on the server too, not merely in the UI.
    const afterSignOut = (await (await page.request.get('/api/auth/session')).json()) as {
      user: unknown | null
    }
    expect(afterSignOut.user).toBeNull()

    // And the door is shut again.
    await gotoHydrated(page, '/accounts')
    await expect(page).toHaveURL(/\/sign-in/)

    // ── sign back in ─────────────────────────────────────────────────────────
    await page.getByLabel('Email').first().fill(email)
    await signInPassword(page).fill(THROWAWAY_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // Back to where they were headed, because sign-in remembered.
    await expect(page).toHaveURL(/\/accounts/)
    // Exact, because this signup is genuinely new — issue #7 means the page
    // now reads a real, empty household, and its own "No accounts yet" `<h2>`
    // also matches a non-exact search for "Accounts".
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible()
  })

  test('keeps the session across a full page reload', async ({ authenticatedPage }) => {
    await gotoHydrated(authenticatedPage, '/accounts')
    await expect(authenticatedPage.getByRole('heading', { name: 'Accounts' })).toBeVisible()

    await authenticatedPage.reload()
    await expect(authenticatedPage.getByRole('heading', { name: 'Accounts' })).toBeVisible()
    await expect(authenticatedPage).toHaveURL(/\/accounts/)
  })
})

test.describe('a session that is no longer good', () => {
  test('redirects rather than erroring when the cookies are gone', async ({
    authenticatedPage,
  }) => {
    await gotoHydrated(authenticatedPage, '/accounts')
    await expect(authenticatedPage.getByRole('heading', { name: 'Accounts' })).toBeVisible()

    // What an expired refresh token looks like from the browser's side: the
    // stored session is gone, and the next request carries nothing.
    await authenticatedPage.context().clearCookies()

    const response = await authenticatedPage.goto('/accounts')
    // A redirect, not a 500 and not an error page.
    expect(response?.status()).toBeLessThan(400)
    await expect(authenticatedPage).toHaveURL(/\/sign-in/)
    await expect(authenticatedPage.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('answers a protected API call with 401 rather than with somebody else’s data', async ({
    page,
  }) => {
    const response = await page.request.get('/api/user-settings')
    expect(response.status()).toBe(401)

    const body = await response.text()
    // Nothing about *why* — an absent token, an expired one and a forged one
    // must not be distinguishable from the outside.
    expect(body).not.toMatch(/expired|malformed|missing|invalid token/i)
  })
})

test.describe('user_id comes from the session, never from the request', () => {
  test('ignores a forged user_id in the query string', async ({ authenticatedPage, session }) => {
    // Signed in as A; asking, in so many words, for B's row.
    const forged = await authenticatedPage.request.get(`/api/user-settings?user_id=${USER_B.id}`)
    expect(forged.status()).toBe(200)

    const body = (await forged.json()) as { settings: { user_id: string } | null }
    expect(body.settings?.user_id).toBe(session.userId)
    expect(body.settings?.user_id).not.toBe(USER_B.id)
  })

  test('ignores a forged user_id in the request body', async ({ authenticatedPage, session }) => {
    // The literal wording of the acceptance criterion. The handler reads no
    // body at all, which is why this changes nothing — and why the assertion is
    // that it changes nothing.
    const forged = await authenticatedPage.request.fetch('/api/user-settings', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ user_id: USER_B.id }),
    })
    expect(forged.status()).toBe(200)

    const body = (await forged.json()) as { settings: { user_id: string } | null }
    expect(body.settings?.user_id).toBe(session.userId)
  })

  test('will not accept another user’s token as this browser’s session', async ({ page }) => {
    // A forged *identity*, rather than a forged parameter: user B's real,
    // valid cookies. The server must answer as B — never as A, and never with
    // both. This is the check that would catch a cache keyed on something
    // other than the session.
    const bSession = await mintBrowserSession(USER_B)
    await page.context().addCookies(
      bSession.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: 'http://127.0.0.1:3000',
      })),
    )

    const response = await page.request.get('/api/user-settings')
    expect(response.status()).toBe(200)

    const body = (await response.json()) as { settings: { user_id: string } | null }
    expect(body.settings?.user_id).toBe(USER_B.id)
    expect(body.settings?.user_id).not.toBe(USER_A.id)
  })
})

test.describe('the password-reset entry points', () => {
  test('acknowledges a reset request identically for any address', async ({ page }) => {
    await gotoHydrated(page, '/forgot-password')

    await page.getByLabel('Email').fill(USER_A.email)
    await page.getByRole('button', { name: 'Email me a link' }).click()
    const registered = (await page.getByRole('status').textContent()) ?? ''
    expect(registered).not.toBe('')

    await page.getByLabel('Email').fill('nobody-here@runway.test')
    await page.getByRole('button', { name: 'Email me a link' }).click()
    const unregistered = (await page.getByRole('status').textContent()) ?? ''

    expect(unregistered).toBe(registered)
  })

  test('sends a used or invalid link to a page that explains nothing', async ({ page }) => {
    // A `code` that was never issued. The route must not echo the failure into
    // a URL or a message: every bad link looks the same.
    await page.goto('/auth/confirm?code=not-a-real-code')

    await expect(page).toHaveURL(/\/auth\/error/)
    await expect(page.getByRole('heading', { name: /didn.t work/i })).toBeVisible()
    expect(page.url()).not.toMatch(/error=|message=|reason=/)
  })

  test('offers the reset form only to somebody holding a recovery session', async ({ page }) => {
    await gotoHydrated(page, '/reset-password')

    // No session: the page says the link is spent and offers a fresh one,
    // rather than presenting a form that would fail on submit.
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Email me a new link' })).toBeVisible()
  })
})
