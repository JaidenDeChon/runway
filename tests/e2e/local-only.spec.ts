/**
 * The guard on where the *app under test* points.
 *
 * `tests/integration/local-only.test.ts` tests the rule — given a URL, is it
 * local — and does it without a database, so it holds on a machine with no
 * stack. This file tests the one thing that file cannot: that the probe
 * feeding it reads a real value out of a real running app.
 *
 * That distinction is the whole reason this spec exists. The rule can be
 * perfect and the guard still be worthless, if `readAppSupabaseTarget` quietly
 * stops finding anything — Nuxt renames a global, a build flag stops exposing
 * the app instance — and every call starts returning nothing. It fails closed
 * for exactly that reason, but "throws when broken" is a backstop, not
 * evidence that it works. This is the evidence.
 *
 * Runs on the plain `page` fixture: no session is needed to read the app's own
 * runtime config, and the sign-in page renders for anybody.
 */

import { LOCAL_STACK } from '../support/database'
import {
  assertBaseUrlIsLocal,
  expect,
  readAppSupabaseTarget,
  requireStackOrSkip,
  test,
} from './fixtures'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
  requireStackOrSkip()
})

test.describe('the app under test', () => {
  test('reports a Supabase URL the harness can actually read', async ({ page }) => {
    await page.goto('/sign-in')
    await page.waitForFunction(() => {
      const root = document.querySelector('#__nuxt') as (Element & { __vue_app__?: unknown }) | null
      return !!root?.__vue_app__
    })

    const target = await readAppSupabaseTarget(page)

    // Non-empty is the half that stops the guard going quiet; equal to the
    // stack this run resolved is the half that proves `playwright.config.ts`'s
    // injection reached the server rather than `.env` winning.
    expect(target).toBeTruthy()
    expect(target).toBe(LOCAL_STACK?.apiUrl)
  })

  test('is not the hosted project, however this run was configured', async ({ page }) => {
    // The assertion `gotoHydrated` makes on every navigation, stated once
    // directly so a reader can see what it is worth. Asserted on the host so
    // no URL reaches the log, per tests/support/stack.ts.
    await page.goto('/sign-in')
    await page.waitForFunction(() => {
      const root = document.querySelector('#__nuxt') as (Element & { __vue_app__?: unknown }) | null
      return !!root?.__vue_app__
    })

    const host = new URL(await readAppSupabaseTarget(page)).hostname
    expect(['127.0.0.1', 'localhost', '::1', '0.0.0.0']).toContain(host)
  })
})
