/**
 * The authenticated-session fixture, exercised and proven.
 *
 * Issue #5 required "a Playwright E2E harness with an authenticated-session
 * fixture". This file is where that fixture is held to being real: it mints a
 * session against the local GoTrue, proves the token authenticates against
 * PostgREST and is subject to RLS, and proves the browser receives it in the
 * exact shape the application will look for.
 *
 * Issue #6 changed that shape from `localStorage` to cookies — see the note at
 * the top of `fixtures.ts` — and, more importantly, made the claim testable
 * from the other end: the app now *does* read the session, so "the fixture
 * works" is no longer a statement about storage alone. The middle test below
 * is the one that says so.
 */

import { signedInClient, USER_A, USER_D } from '../support/database'
import {
  assertBaseUrlIsLocal,
  assertSessionAuthenticates,
  expect,
  gotoHydrated,
  test,
} from './fixtures'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('the authenticated-session fixture', () => {
  test('mints a session that the data layer actually accepts', async ({ session }) => {
    expect(session.userId).toBe(USER_A.id)
    expect(session.accessToken.split('.')).toHaveLength(3)

    // Not vacuous: the seeded user owns rows, so a working session sees some.
    const visibleRows = await assertSessionAuthenticates(session)
    expect(visibleRows).toBeGreaterThan(0)
  })

  test('hands the browser a session the server itself recognises', async ({
    authenticatedPage,
    session,
  }) => {
    // The end-to-end statement, and the reason cookies replaced `localStorage`:
    // this endpoint's answer is produced on the *server*, from a token
    // validated against the auth server, with nothing read from the page.
    const response = await authenticatedPage.request.get('/api/auth/session')
    expect(response.status()).toBe(200)

    const body = (await response.json()) as { user: { id: string; email: string } | null }
    expect(body.user?.id).toBe(session.userId)
    expect(body.user?.email).toBe(USER_A.email)
  })

  test('installs the cookies under the names @supabase/ssr chose', async ({
    authenticatedPage,
    session,
  }) => {
    await gotoHydrated(authenticatedPage, '/')

    const cookies = await authenticatedPage.context().cookies()
    const names = cookies.map((cookie) => cookie.name)

    // The names are derived by the library from the project URL, never
    // hardcoded here — see the note in tests/e2e/fixtures.ts.
    for (const cookie of session.cookies) {
      expect(names).toContain(cookie.name)
    }
    expect(names.some((name) => name.includes('auth-token'))).toBe(true)
  })

  test('survives a client-side navigation, as a real session would', async ({
    authenticatedPage,
  }) => {
    await gotoHydrated(authenticatedPage, '/accounts')
    await expect(authenticatedPage.getByRole('heading', { name: 'Accounts' })).toBeVisible()

    // Still the signed-in user afterwards, asked of the server rather than of
    // the page's own state.
    const response = await authenticatedPage.request.get('/api/auth/session')
    const body = (await response.json()) as { user: { id: string } | null }
    expect(body.user?.id).toBe(USER_A.id)
  })

  /**
   * The acceptance criterion the earlier `fixme` here named: "the UI renders
   * rows that came from the database," proven now that issue #7 moved
   * `app/composables/useRunwayData.ts` onto Supabase.
   *
   * Deliberately not "sign in as user C and look for Checking/Savings": C's
   * accounts carry those same names (only the balances differ), so that
   * version would pass whether or not the database was ever read — and a
   * balance must never reach an assertion, which ruling out C's approach by
   * name would have required anyway. Instead this inserts a row through
   * PostgREST under **user D's own session** — exercising the INSERT policy,
   * not the admin connection — with a name built at runtime and present
   * nowhere in the source, so the only way it can appear on screen is a
   * genuine read of what was just written.
   */
  test('shows the signed-in user rows that came from the database', async ({
    emptyHouseholdPage,
  }) => {
    const rowName = `e2e-db-read-${crypto.randomUUID().slice(0, 8)}`
    const client = await signedInClient(USER_D)
    const { error } = await client.from('accounts').insert({
      user_id: USER_D.id,
      name: rowName,
      color: 'chart-2',
      balance_cents: 100,
      balance_as_of: '2026-08-01',
    })
    expect(error).toBeNull()

    await gotoHydrated(emptyHouseholdPage, '/accounts')
    await expect(emptyHouseholdPage.getByText(rowName, { exact: true })).toBeVisible()
  })
})
