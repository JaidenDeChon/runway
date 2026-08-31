/**
 * Every text field in the app is the same control.
 *
 * This exists because it stopped being true and nobody noticed for a while.
 * `MoneyInput` wrapped its input in a hand-rolled box so it could sit a `$`
 * and a sign toggle beside the text, and that box drifted from `Input` on
 * three properties at once — 8px corners against the field's 32px pill, an
 * opaque `--background` fill against `--input`/30, and a different height.
 * Three fields sat in one row of the account editor and one of them was
 * visibly a different control.
 *
 * `app/lib/field.ts` is the fix; this is the test that keeps it fixed. It
 * measures *computed* style rather than asserting class names, because the
 * class names are exactly what a well-meaning refactor changes.
 *
 * The second test is the other half of the same row: a control that will not
 * shrink pushes its grid column past `1fr` and the dialog scrolls sideways.
 * WebKit gives `input[type=date]` an intrinsic width large enough to do that,
 * and grid items default to `min-width: auto`, so the column has no say.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('the account editor', () => {
  test('renders its three fields as one control, not three', async ({
    authenticatedPage: page,
  }) => {
    await gotoHydrated(page, '/accounts')
    await clickUntil(page.getByText('Checking', { exact: true }), page.getByRole('dialog'))

    // Park focus somewhere that is not one of the three fields. The dialog
    // autofocuses Name on open, and a focused field wears `--ring` on its
    // border — comparing it against two resting ones measures focus, not
    // design. Cancel is inside the dialog, so the focus trap stays satisfied.
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).focus()

    // `FIELD_SHELL` carries `transition-colors`, so a border read mid-flight
    // comes back as Chromium's interpolated `oklab(...)` rather than the
    // token's own `oklch(...)` — the same colour, a different moment. Settling
    // first is what makes this assertion about design rather than about timing.
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))
    })

    const measured = await page.evaluate(() => {
      /** The chrome that makes a field look like a field, as the browser computed it. */
      const chrome = (el: Element) => {
        const style = getComputedStyle(el)
        return {
          height: Math.round(el.getBoundingClientRect().height),
          radius: style.borderTopLeftRadius,
          background: style.backgroundColor,
          borderColor: style.borderTopColor,
          borderWidth: style.borderTopWidth,
        }
      }
      const balance = document.querySelector('#account-balance') as HTMLElement
      return {
        // The money field's shell is its wrapper, not the input: that is the
        // element carrying the border, and the whole point of the bug.
        name: chrome(document.querySelector('#account-name') as Element),
        balance: chrome(balance.parentElement as Element),
        asOf: chrome(document.querySelector('#account-as-of') as Element),
      }
    })

    // Asserted against each other rather than against literals. The design may
    // move the radius or the fill; what must never happen again is one field
    // moving and the others staying put.
    expect(measured.balance).toEqual(measured.name)
    expect(measured.asOf).toEqual(measured.name)

    // And the money field is a real field, not an invisible one — a shell that
    // matched by all being 0 would satisfy the equality above.
    expect(measured.name).toMatchObject({ borderWidth: '1px' })
    expect(Number.parseInt(measured.name.radius, 10)).toBeGreaterThan(0)
  })

  test('never scrolls sideways, whatever the date control wants to be', async ({
    authenticatedPage: page,
  }) => {
    await gotoHydrated(page, '/accounts')
    await clickUntil(page.getByText('Checking', { exact: true }), page.getByRole('dialog'))

    const layout = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement
      const date = document.querySelector('#account-as-of') as HTMLElement
      const column = date.parentElement as HTMLElement
      const grid = column.parentElement as HTMLElement
      return {
        dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
        gridOverflow: grid.scrollWidth - grid.clientWidth,
        // The load-bearing property. A grid item defaults to `min-width: auto`
        // and then cannot shrink below its content, which is how one wide
        // control takes the whole dialog with it.
        columnMinWidth: getComputedStyle(column).minWidth,
        dateWithinColumn:
          Math.round(date.getBoundingClientRect().width) <=
          Math.round(column.getBoundingClientRect().width),
      }
    })

    expect(layout.columnMinWidth).toBe('0px')
    expect(layout.dateWithinColumn).toBe(true)
    expect(layout.gridOverflow).toBeLessThanOrEqual(1)
    expect(layout.dialogOverflow).toBeLessThanOrEqual(1)
  })
})
