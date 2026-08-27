import { defineConfig, devices } from '@playwright/test'

/**
 * The E2E harness.
 *
 * ## Where it points, and why it cannot point anywhere else
 *
 * `baseURL` is loopback and is validated as loopback before any test runs — see
 * `tests/e2e/fixtures.ts`. The same rule the integration suite is held to
 * applies here for a stronger reason: an E2E run drives a real browser through
 * real writes, and the one thing it must never do those writes against is the
 * hosted project. `RUNWAY_E2E_BASE_URL` exists so a preview build on another
 * port can be tested, and it goes through the same guard.
 *
 * ## The server under test
 *
 * A production preview (`bun run build && bun run preview`), not the Nuxt dev
 * server. This started as dev and moved, for a concrete reason: the dev server
 * compiles routes lazily on first request, and on a cold CI runner with no
 * `.nuxt` cache it did not become ready inside 180s — the whole E2E job failed
 * without running a single test, while passing locally where the cache was
 * warm. Raising the timeout would have treated the symptom and left the
 * suite's slowest and least predictable step on every pull request's critical
 * path.
 *
 * The preview server serves an already-built Nitro output and is listening in
 * seconds. It also means the suite now exercises what actually ships, which the
 * dev server never did.
 *
 * The build is part of the default command so `bun run test:e2e` works from a
 * clean checkout with no ceremony. CI overrides it with
 * `RUNWAY_E2E_SERVER_COMMAND=bun run preview` and builds in an explicit step
 * instead, so a build failure is reported as a build failure rather than as a
 * server that never came up.
 *
 * ## Two viewports
 *
 * `CLAUDE.md` says mobile-first, built at 375px and adapted upward. A harness
 * that only ever drove a desktop viewport would let the 375px layout rot
 * unobserved, so both are projects here.
 */

const BASE_URL = process.env.RUNWAY_E2E_BASE_URL ?? 'http://127.0.0.1:3000'

/**
 * Build then serve, unless the caller has already built.
 *
 * `reuseExistingServer` short-circuits this entirely when a server is already
 * listening locally, so the inner-loop cost is paid once per change, not once
 * per run.
 */
const SERVER_COMMAND = process.env.RUNWAY_E2E_SERVER_COMMAND ?? 'bun run build && bun run preview'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',

  // A CI run must never quietly narrow itself to whatever somebody was
  // debugging.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  /**
   * One worker, always.
   *
   * The authenticated fixtures seed a shared local database as shared seed
   * users. Parallel workers would interleave those writes and produce failures
   * that look like application bugs. Per-worker users would fix it and are not
   * worth the complexity until the suite is big enough to be slow.
   */
  workers: 1,

  // The whole E2E suite runs on every pull request; this is the ceiling it is
  // held to, in the same spirit as the integration project's wall-clock budget.
  // Spread rather than assigned `undefined`, because `exactOptionalPropertyTypes`
  // draws a distinction between "absent" and "explicitly undefined".
  ...(process.env.CI ? { globalTimeout: 15 * 60 * 1000 } : {}),
  timeout: 60_000,
  expect: { timeout: 10_000 },

  /**
   * `list` in CI rather than a reporter that echoes page content.
   *
   * The issue requires that CI logs contain no balances. Traces and screenshots
   * do contain rendered figures, which is exactly what makes them useful for
   * debugging — they are uploaded as build artifacts, not printed to the log.
   */
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    // The issue's words: "trace on failure". `retain-on-failure` keeps a trace
    // for a test that failed and discards every passing one, so the artifact
    // stays small enough that people actually download it.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Everything is loopback; a proxy in the environment must not intercept it.
    ignoreHTTPSErrors: false,
  },

  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 375px — the width `CLAUDE.md` says every screen is built at first.
      //
      // Built from `Pixel 5` rather than `iPhone SE` for one reason: device
      // descriptors carry a `defaultBrowserType`, and the iPhone ones say
      // `webkit`. A project named "chromium-mobile" that quietly launched
      // WebKit would need a second browser downloaded in CI to run at all.
      // Pixel 5 is chromium-backed and brings the touch/mobile flags with it;
      // the viewport is then overridden to the width the design is drawn at.
      name: 'chromium-mobile',
      use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } },
    },
  ],

  webServer: {
    command: SERVER_COMMAND,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // Generous because the default command includes a production build. When CI
    // overrides the command to serve an already-built output, readiness is a
    // matter of seconds and this ceiling is never approached.
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
