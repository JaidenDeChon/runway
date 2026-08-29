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

import { USER_A } from '../support/database'
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
   * The acceptance criterion this harness still cannot satisfy, written down
   * rather than omitted — and re-pointed at the issue that actually owns it.
   *
   * "At least one E2E test completing a real user flow against a seeded
   * database" needs the *application* to read the database. Issue #6 gave it a
   * session and a server that validates one; it deliberately did not move
   * `app/composables/useRunwayData.ts` off `domain/seed.ts`, because reading
   * accounts from Supabase is issue #7's scope, not authentication's.
   *
   * **Do not simply delete the `fixme` when #7 lands.** The in-memory seed also
   * contains "Checking" and "Savings", so this test would pass without the
   * database being touched at all — it would be green for the wrong reason.
   * Whoever un-fixmes it must first make the assertion distinguish the two
   * sources: sign in as user **C**, whose seeded household differs from the
   * in-memory one, or assert on a row written through PostgREST during the
   * test.
   */
  test.fixme('shows the signed-in user their own seeded household [blocked on #7: accounts management]', async ({
    authenticatedPage,
  }) => {
    await gotoHydrated(authenticatedPage, '/accounts')
    await expect(authenticatedPage.getByText('Checking', { exact: true })).toBeVisible()
    await expect(authenticatedPage.getByText('Savings', { exact: true })).toBeVisible()
  })
})
