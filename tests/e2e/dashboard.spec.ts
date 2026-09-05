/**
 * The dashboard's display settings, end to end.
 *
 * This is the one piece of the app whose behaviour *is* a round trip through
 * the browser: `useChartDensity` reads and writes `localStorage`, deliberately
 * after mount rather than during setup, and the correctness of that ordering is
 * not observable anywhere below the browser. A unit test could exercise
 * `normalizeDensity` — `app/lib/burndown.test.ts` does — but it cannot see the
 * hydration rule the composable exists to obey, and it cannot see whether the
 * value the user set is the value they get back tomorrow.
 *
 * So the assertions here are about three things a lower layer cannot reach:
 *
 * 1. the panel is a real dialog with real labelled controls,
 * 2. a change survives a reload, and
 * 3. a stored value that is wrong — out of range, or not a density at all —
 *    leaves the page working rather than breaking it.
 *
 * There is a fourth, and it is the reason this file asserts on storage
 * *contents* rather than only on what is drawn: CLAUDE.md forbids balances
 * leaving the app, and `localStorage` is somewhere they could leave to. The
 * composable's comment says it writes presentation numbers only. That is
 * checked here, against the real key, rather than trusted.
 *
 * The density tests' household is user A's seeded Supabase rows, same as the
 * accounts spec's read path — a fresh `page.goto` is enough to have a chart
 * to adjust, and nothing there writes, so `authenticatedPage` is the right
 * fixture for them.
 *
 * The forecast-horizon test below is different: issue #12 made the horizon a
 * *stored* preference (`user_settings.default_horizon_days`), so clicking
 * `90d` is now a write. Running it on user A would permanently move A's
 * stored horizon to 90 — failing the test's own first assertion on a second
 * run, and changing the default for every other A-based spec. It runs on
 * `emptyHouseholdPage` (user D) instead, adding one account through the UI
 * first so the dashboard has something to chart.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

/** The key `useChartDensity` owns. Named here so a rename fails loudly. */
const STORAGE_KEY = 'runway.chart-density'

/** `DEFAULT_DENSITY` in `app/lib/burndown.ts`, restated so a drift is visible. */
const DEFAULT_DENSITY = { lineWeight: 4, dashDensity: 10, markerSize: 0.9 }

/** `DENSITY_BOUNDS`, likewise. */
const BOUNDS = {
  lineWeight: { min: 4, max: 14 },
  dashDensity: { min: 3, max: 18 },
  markerSize: { min: 0.6, max: 1.8 },
}

type StoredDensity = Record<string, unknown> | null

async function readStoredDensity(
  page: import('@playwright/test').Page,
): Promise<StoredDensity | 'unparseable'> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return 'unparseable' as const
    }
  }, STORAGE_KEY)
}

/** Put a value in storage before any application script runs, as a return visit would. */
async function seedStoredDensity(
  page: import('@playwright/test').Page,
  raw: string,
): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value)
    },
    { key: STORAGE_KEY, value: raw },
  )
}

async function openDisplaySettings(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog')
  await clickUntil(page.getByRole('button', { name: 'Chart display settings' }), dialog)
  return dialog
}

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('the chart display settings', () => {
  test('open as a dialog whose controls are all named', async ({ authenticatedPage: page }) => {
    await gotoHydrated(page, '/')

    const dialog = await openDisplaySettings(page)
    await expect(dialog).toContainText('Chart display')

    // Named on the *thumb*, which is where reka-ui puts `role="slider"`. A
    // label on the group would announce as "Value" to a screen reader, which
    // is the bug `app/components/ui/slider/Slider.vue` was patched to avoid —
    // and re-running `shadcn-vue add slider` silently reintroduces it.
    for (const name of ['Line weight', 'Dash density', 'Marker size']) {
      await expect(dialog.getByRole('slider', { name })).toBeVisible()
    }
  })

  test('start at the default when nothing has been stored', async ({ authenticatedPage: page }) => {
    await gotoHydrated(page, '/')

    // Nothing is written until the user changes something: a first visit that
    // wrote the default back would make "never chosen" indistinguishable from
    // "chose the default", which is what a signed-in profile will later need to
    // tell apart.
    expect(await readStoredDensity(page)).toBeNull()

    const dialog = await openDisplaySettings(page)
    await expect(dialog.getByRole('slider', { name: 'Line weight' })).toHaveAttribute(
      'aria-valuenow',
      String(DEFAULT_DENSITY.lineWeight),
    )
  })

  test('remember a change across a reload', async ({ authenticatedPage: page }) => {
    await gotoHydrated(page, '/')
    const dialog = await openDisplaySettings(page)

    const lineWeight = dialog.getByRole('slider', { name: 'Line weight' })
    await lineWeight.focus()
    // Keyboard rather than a drag: it moves by exactly one step, so the
    // expected value is arithmetic rather than a guess about pixel geometry —
    // and it proves the control is operable without a pointer.
    await lineWeight.press('ArrowRight')
    await lineWeight.press('ArrowRight')

    const raised = DEFAULT_DENSITY.lineWeight + 2
    await expect(lineWeight).toHaveAttribute('aria-valuenow', String(raised))

    // Written through to storage, not merely held in memory.
    await expect(async () => {
      expect(await readStoredDensity(page)).toMatchObject({ lineWeight: raised })
    }).toPass({ timeout: 5_000 })

    await gotoHydrated(page, '/')
    const afterReload = await openDisplaySettings(page)
    await expect(afterReload.getByRole('slider', { name: 'Line weight' })).toHaveAttribute(
      'aria-valuenow',
      String(raised),
    )
  })

  test('store presentation numbers and nothing else', async ({ authenticatedPage: page }) => {
    await gotoHydrated(page, '/')
    const dialog = await openDisplaySettings(page)

    const marker = dialog.getByRole('slider', { name: 'Marker size' })
    await marker.focus()
    await marker.press('ArrowRight')

    await expect(async () => {
      const stored = await readStoredDensity(page)
      expect(stored).not.toBeNull()
      expect(stored).not.toBe('unparseable')
      // The whole record, key by key. A balance, an account name or an id
      // reaching browser storage is the thing CLAUDE.md rules out, and an
      // assertion on the exact key set is what would catch one arriving.
      expect(Object.keys(stored as Record<string, unknown>).sort()).toEqual([
        'dashDensity',
        'lineWeight',
        'markerSize',
      ])
      for (const value of Object.values(stored as Record<string, unknown>)) {
        expect(typeof value).toBe('number')
      }
    }).toPass({ timeout: 5_000 })
  })

  test('clamp a stored value that is out of range', async ({ authenticatedPage: page }) => {
    // What an older build with wider bounds, or a user editing storage by hand,
    // would leave behind. `normalizeDensity` clamps rather than rejecting the
    // whole record over one bad field; this proves the composable actually
    // routes restored values through it.
    await seedStoredDensity(
      page,
      JSON.stringify({
        lineWeight: 9_999,
        dashDensity: -40,
        markerSize: DEFAULT_DENSITY.markerSize,
      }),
    )
    await gotoHydrated(page, '/')

    const dialog = await openDisplaySettings(page)
    await expect(dialog.getByRole('slider', { name: 'Line weight' })).toHaveAttribute(
      'aria-valuenow',
      String(BOUNDS.lineWeight.max),
    )
    await expect(dialog.getByRole('slider', { name: 'Dash density' })).toHaveAttribute(
      'aria-valuenow',
      String(BOUNDS.dashDensity.min),
    )
  })

  for (const [description, raw] of [
    ['is not JSON at all', 'not json'],
    ['is JSON but not a density', JSON.stringify({ lineWeight: 'thick' })],
    ['is missing a field', JSON.stringify({ lineWeight: 6, dashDensity: 12 })],
  ] as const) {
    test(`fall back to the default when the stored value ${description}`, async ({
      authenticatedPage: page,
    }) => {
      await seedStoredDensity(page, raw)
      await gotoHydrated(page, '/')

      // The chart still renders. A corrupt cosmetic preference must never be
      // the reason someone cannot see their money.
      await expect(page.getByRole('heading', { name: 'Balance forecast' })).toBeVisible()

      const dialog = await openDisplaySettings(page)
      await expect(dialog.getByRole('slider', { name: 'Line weight' })).toHaveAttribute(
        'aria-valuenow',
        String(DEFAULT_DENSITY.lineWeight),
      )
    })
  }
})

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

test.describe('the forecast horizon', () => {
  test('is a labelled group whose selection changes the window drawn', async ({
    emptyHouseholdPage: page,
  }) => {
    // Issue #12 made the horizon a stored preference — see the file header
    // comment for why this runs on D rather than A.
    await addAccount(page, 'E2E Horizon', '1000')
    await gotoHydrated(page, '/')

    const group = page.getByRole('group', { name: 'Forecast horizon' })
    await expect(group).toBeVisible()
    await expect(group.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true')

    // The chart's accessible description names the window it covers, so it is
    // the one place a horizon change is observable without reading pixels.
    //
    // Compared as a boolean computed here rather than asserted as a string: the
    // description also carries the lowest projected balance, and a failed
    // string comparison would print that balance into the CI log, which the
    // suite is explicitly not allowed to do.
    const chart = page.getByRole('img', { name: /Balance forecast/ })
    const before = await chart.getAttribute('aria-label')
    expect(before).not.toBeNull()

    const ninety = group.getByRole('button', { name: '90d' })
    await clickUntil(ninety, group.locator('[aria-pressed="true"]').filter({ hasText: '90d' }))
    await expect(ninety).toHaveAttribute('aria-pressed', 'true')

    await expect
      .poll(async () => (await chart.getAttribute('aria-label')) !== before, {
        message: 'the chart description did not change when the horizon did',
      })
      .toBe(true)
  })
})

test.describe('the burndown chart', () => {
  test('renders one segment pair per line, and a combined line only with two accounts', async ({
    authenticatedPage: page,
  }) => {
    await gotoHydrated(page, '/')

    await expect(page.getByRole('img', { name: /Balance forecast/ })).toBeVisible()

    // User A's seeded household has two accounts (Checking, Savings), both
    // selected by default: one line each plus the combined line, three drawn
    // lines in total, each split into a past segment and a future one.
    await expect(page.locator('svg [data-segment="past"]')).toHaveCount(3)
    await expect(page.locator('svg [data-segment="future"]')).toHaveCount(3)

    const savings = page.getByRole('checkbox', { name: /Show Savings on the chart/ })
    // The same swallowed-click concern clickUntil exists for, adapted to a
    // count rather than a visibility change: retry the click until the
    // segment count actually reflects one fewer drawn line.
    await expect(async () => {
      if ((await page.locator('svg [data-segment="past"]').count()) === 1) return
      await savings.click({ timeout: 2_000 })
      await expect(page.locator('svg [data-segment="past"]')).toHaveCount(1, { timeout: 1_000 })
    }).toPass({ timeout: 20_000 })

    await expect(page.locator('svg [data-segment="future"]')).toHaveCount(1)
    await expect(page.getByText('Combined', { exact: true })).toHaveCount(0)
  })

  test('draws history solid and the forecast dashed', async ({ authenticatedPage: page }) => {
    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    await expect(chart).toBeVisible()

    await expect(page.locator('svg [data-segment="past"]').first()).not.toHaveAttribute(
      'stroke-dasharray',
      /./,
    )
    await expect(page.locator('svg [data-segment="future"]').first()).toHaveAttribute(
      'stroke-dasharray',
      /\d/,
    )

    // The accessible half of the same claim: computed as a boolean here, never
    // asserted with toHaveAttribute against a pattern, because a failure would
    // print the whole aria-label — which carries a balance — into the CI log.
    // dashboard.spec.ts's own horizon test and recurring-items.spec.ts both
    // already use this boolean-poll idiom.
    await expect
      .poll(async () => {
        const label = (await chart.getAttribute('aria-label')) ?? ''
        return label.includes('drawn as a dashed line')
      })
      .toBe(true)
  })

  // Regression: the annotation overlay used to be `absolute inset-0` inside a
  // wrapper that also holds the x-tick row, so its box was taller than the
  // chart and every percentage-positioned label was pushed down by the
  // difference. That is not a cosmetic drift — it silently cancelled the
  // 14-unit offsets that keep the lowest-point label off the line it
  // annotates, putting the label back through the line. The invariant those
  // offsets depend on is simply that the two boxes are the same box.
  test('positions its annotation layer over exactly the chart, not the tick row', async ({
    authenticatedPage: page,
  }) => {
    await gotoHydrated(page, '/')

    const chart = page.getByRole('img', { name: /Balance forecast/ })
    await expect(chart).toBeVisible()

    const svgBox = await chart.boundingBox()
    const overlayBox = await page.locator('[data-chart-annotations]').boundingBox()
    expect(svgBox).not.toBeNull()
    expect(overlayBox).not.toBeNull()

    // Sub-pixel tolerance only: these are meant to be the same rectangle.
    expect(Math.abs(overlayBox!.y - svgBox!.y)).toBeLessThan(1)
    expect(Math.abs(overlayBox!.height - svgBox!.height)).toBeLessThan(1)
    expect(Math.abs(overlayBox!.width - svgBox!.width)).toBeLessThan(1)
  })
})

test.describe('opening a day from the chart', () => {
  test('a day click opens the day editor', async ({ authenticatedPage: page }) => {
    await gotoHydrated(page, '/')

    // An interior day, so its hit band is full width rather than clipped at
    // the plot edge.
    const rect = page.locator('svg rect[data-day]').nth(20)
    await clickUntil(rect, page.getByRole('dialog', { name: 'Day detail' }))
    await expect(page.getByRole('dialog', { name: 'Day detail' })).toBeVisible()
  })

  test('the same day is reachable without a pointer', async ({ authenticatedPage: page }) => {
    await gotoHydrated(page, '/')

    // AC63-6's regression guard: focusing the chart lands on today (see
    // BurndownChart.vue's onFocus), so Enter alone — no click, no arrow keys —
    // must open the same editor.
    const chart = page.getByRole('img', { name: /Balance forecast/ })
    await chart.focus()
    await chart.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Day detail' })).toBeVisible()
  })
})
