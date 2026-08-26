/**
 * The authenticated-session fixture, exercised and proven.
 *
 * Issue #5 requires "a Playwright E2E harness with an authenticated-session
 * fixture". This file is where that fixture is held to being real: it mints a
 * session against the local GoTrue, proves the token authenticates against
 * PostgREST and is subject to RLS, and proves the browser receives it in the
 * exact shape `@supabase/supabase-js` will look for.
 *
 * What it deliberately does not claim is that the *application* uses it. It
 * does not, yet — `app/composables/useRunwayData.ts` holds the household in
 * memory and `AppUserMenu.vue` names issue #6 as the owner of real session
 * data. The last test in this file is the one that closes that gap, and it is
 * committed as a `fixme` rather than quietly left out.
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

  test('hands the browser the session under the key supabase-js chose', async ({
    authenticatedPage,
    session,
  }) => {
    await gotoHydrated(authenticatedPage, '/')

    const stored = await authenticatedPage.evaluate(
      (key: string) => window.localStorage.getItem(key),
      session.storageKey,
    )

    expect(stored).not.toBeNull()
    // The key is derived by the library from the project URL, never hardcoded
    // here — see the note in tests/e2e/fixtures.ts.
    expect(session.storageKey).toMatch(/auth-token$/)

    const parsed = JSON.parse(stored ?? '{}') as { access_token?: string; user?: { id?: string } }
    expect(parsed.access_token).toBe(session.accessToken)
    expect(parsed.user?.id).toBe(USER_A.id)
  })

  test('survives a client-side navigation, as a real session would', async ({
    authenticatedPage,
    session,
  }) => {
    await gotoHydrated(authenticatedPage, '/accounts')
    await expect(authenticatedPage.getByRole('heading', { name: 'Accounts' })).toBeVisible()

    const stillThere = await authenticatedPage.evaluate(
      (key: string) => window.localStorage.getItem(key) !== null,
      session.storageKey,
    )
    expect(stillThere).toBe(true)
  })

  /**
   * The acceptance criterion this harness cannot yet satisfy, written down
   * rather than omitted.
   *
   * "At least one E2E test completing a real user flow against a seeded
   * database" needs the application to read the database. It does not: the
   * dashboard renders `domain/seed.ts` from memory. Building sign-in and a
   * persistence layer here would be doing issue #6's work inside issue #5's
   * PR, so what lands instead is the harness that makes this a one-file change
   * on the day #6 arrives — the fixture above is already proven against the
   * real seeded database.
   *
   * When #6 lands: delete the `fixme`, and assert against user A's seeded
   * household (`supabase/seed.sql`, mirroring `createSeedData()`), which the
   * fixture is already signed in as.
   */
  test.fixme('shows the signed-in user their own seeded household [blocked on #6: authentication]', async ({
    authenticatedPage,
  }) => {
    await gotoHydrated(authenticatedPage, '/accounts')
    // User A's seeded accounts, from supabase/seed.sql — not from memory.
    await expect(authenticatedPage.getByText('Checking', { exact: true })).toBeVisible()
    await expect(authenticatedPage.getByText('Savings', { exact: true })).toBeVisible()
  })
})
