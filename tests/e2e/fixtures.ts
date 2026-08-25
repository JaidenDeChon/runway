/**
 * The E2E harness's fixtures — chiefly the authenticated-session one.
 *
 * ## The honest state of this, today
 *
 * Issue #5 asks for "a Playwright E2E harness with an authenticated-session
 * fixture" and "at least one E2E test completing a real user flow against a
 * seeded database". The app it is being built for **has no sign-in and reads
 * nothing from the database**: `app/composables/useRunwayData.ts` holds the
 * household in memory from `domain/seed.ts`, and `AppUserMenu.vue` says in its
 * first line that real session data belongs to issue #6.
 *
 * There were three ways to respond to that and only one of them is honest.
 * Building authentication here would be annexing issue #6. Writing a test that
 * asserts against the in-memory seed and calling it "against a seeded database"
 * would redefine the acceptance criterion quietly, which is worse than missing
 * it. What is done instead:
 *
 * - The fixture mints a **real** session against the local GoTrue, with the
 *   same seed users the integration suite signs in as, and **proves it works**
 *   by using the minted token to read that user's rows through PostgREST before
 *   handing it to the browser. The fixture is not a placeholder; it is verified
 *   every time it runs.
 * - It installs that session where `@supabase/supabase-js` will look for it,
 *   so the day `createRunwayClient` is wired into the app the fixture keeps
 *   working with no edit.
 * - The flows that can be driven end-to-end **today** are driven today, for
 *   real, against the running app.
 * - The one assertion that genuinely cannot be made yet — "the UI renders rows
 *   that came from the database" — is committed as a `test.fixme` naming issue
 *   #6, rather than omitted and forgotten.
 *
 * ## Why the storage key is not hardcoded
 *
 * `supabase-js` derives its storage key from the project URL and has changed
 * that derivation between versions. Rather than guess `sb-127-auth-token` and
 * be quietly wrong later, the fixture hands a real client a storage adapter
 * that records what it writes, signs in, and uses exactly the key and value the
 * library chose. The library is the authority on its own format.
 */

import { test as base, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { LOCAL_STACK, type SeedUser, USER_A } from '../support/database'
import { assertLocalOnly, hostOf, isLoopbackHost } from '../support/stack'

export { expect }

export interface BrowserSession {
  /** The `localStorage` key `supabase-js` itself chose for this project URL. */
  readonly storageKey: string
  /** The serialized session, exactly as `supabase-js` would have written it. */
  readonly storageValue: string
  readonly accessToken: string
  readonly userId: string
}

/**
 * Signs in for real and captures what `supabase-js` persists.
 *
 * The capturing storage adapter is the whole trick: it makes the library
 * disclose both halves of the pair the app will later look for, instead of this
 * file asserting a format it does not own.
 */
export async function mintBrowserSession(user: SeedUser): Promise<BrowserSession> {
  if (!LOCAL_STACK) throw new Error('mintBrowserSession requires the local Supabase stack')

  const written = new Map<string, string>()
  const client = createClient(LOCAL_STACK.apiUrl, LOCAL_STACK.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (key: string) => written.get(key) ?? null,
        setItem: (key: string, value: string) => {
          written.set(key, value)
        },
        removeItem: (key: string) => {
          written.delete(key)
        },
      },
    },
  })

  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error || !data.session) {
    throw new Error(`could not sign in as ${user.email}: ${error?.message ?? 'no session'}`)
  }

  const entries = [...written.entries()].filter(([key]) => key.includes('auth-token'))
  const entry = entries[0]
  if (!entry) {
    throw new Error(
      'supabase-js persisted no auth-token entry, so this fixture cannot know what key the ' +
        'app will read. Check the client options in tests/e2e/fixtures.ts against the ' +
        'installed @supabase/supabase-js version.',
    )
  }

  return {
    storageKey: entry[0],
    storageValue: entry[1],
    accessToken: data.session.access_token,
    userId: data.user?.id ?? '',
  }
}

/**
 * Proves a minted token actually authenticates, before any test relies on it.
 *
 * Without this the fixture could hand the browser a dead token for a whole
 * release and nothing would notice, because nothing in the app reads it yet.
 */
export async function assertSessionAuthenticates(session: BrowserSession): Promise<number> {
  if (!LOCAL_STACK) throw new Error('assertSessionAuthenticates requires the local Supabase stack')

  const response = await fetch(
    `${LOCAL_STACK.apiUrl.replace(/\/$/, '')}/rest/v1/accounts?select=id,user_id`,
    {
      headers: {
        apikey: LOCAL_STACK.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/json',
      },
    },
  )
  if (response.status !== 200) {
    throw new Error(`the minted session was refused by PostgREST: HTTP ${response.status}`)
  }
  const rows = (await response.json()) as { id: string; user_id: string }[]
  const foreign = rows.filter((row) => row.user_id !== session.userId)
  if (foreign.length > 0) {
    throw new Error(`RLS BREACH: the minted session can see ${foreign.length} foreign row(s)`)
  }
  return rows.length
}

interface RunwayFixtures {
  /** A page that already holds a verified session for the seeded user A. */
  authenticatedPage: import('@playwright/test').Page
  session: BrowserSession
}

export const test = base.extend<RunwayFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature requires the destructured first argument even when nothing is taken from it.
  session: async ({}, use) => {
    test.skip(LOCAL_STACK === null, 'needs the local Supabase stack — `bun run db:start`')
    const session = await mintBrowserSession(USER_A)
    await assertSessionAuthenticates(session)
    await use(session)
  },

  authenticatedPage: async ({ page, session }, use) => {
    // Installed before any application script runs, so the app finds the
    // session on its very first evaluation rather than after a re-render.
    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        window.localStorage.setItem(key, value)
      },
      { key: session.storageKey, value: session.storageValue },
    )
    await use(page)
  },
})

/**
 * The same local-only rule the integration suite is held to, applied to the
 * browser target.
 *
 * An E2E run drives real writes through a real browser. Pointing one at a
 * deployed environment by setting an environment variable is an easy accident
 * and an expensive one, so it fails here instead.
 */
export function assertBaseUrlIsLocal(baseURL: string | undefined): void {
  if (!baseURL) throw new Error('no baseURL configured for the E2E suite')
  const host = hostOf(baseURL)
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Refusing to run E2E tests against "${host}". This suite drives real writes; ` +
        'it runs against a local dev server only.',
    )
  }
  if (LOCAL_STACK) assertLocalOnly(LOCAL_STACK, 'the resolved stack')
}
