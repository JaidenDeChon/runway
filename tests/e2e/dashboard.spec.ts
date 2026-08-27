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
 * The household on screen is `domain/seed.ts` for now, same as the accounts
 * spec — a fresh `page.goto` is enough to have a chart to adjust.
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
  test('open as a dialog whose controls are all named', async ({ page }) => {
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

  test('start at the default when nothing has been stored', async ({ page }) => {
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

  test('remember a change across a reload', async ({ page }) => {
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

  test('store presentation numbers and nothing else', async ({ page }) => {
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

  test('clamp a stored value that is out of range', async ({ page }) => {
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
    test(`fall back to the default when the stored value ${description}`, async ({ page }) => {
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

test.describe('the forecast horizon', () => {
  test('is a labelled group whose selection changes the window drawn', async ({ page }) => {
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
