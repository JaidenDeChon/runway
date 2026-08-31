/**
 * Overdrawn accounts, end to end.
 *
 * `accounts.balance_cents` has always been a plain `bigint` with no
 * non-negative check, `formatMoney` has always rendered `−$1,234`, and the
 * accounts spec has always said "negatives as `-$1,234`". The one thing
 * missing was a way to *type* one: the balance field defaulted to `min: 0`,
 * and on iOS the numeric keypad has no minus key at all — so on the device
 * most people would reach for, an overdrawn balance was unreachable.
 *
 * These tests drive the two routes in (the sign toggle and a typed minus),
 * prove the value survives a round trip through Supabase, and prove the
 * dashboard says out loud that the balance goes negative — the zero line
 * `containsZero` gates is a visual cue and a screen reader gets nothing from
 * it.
 *
 * The last test is the other half of the rule: the toggle is opt-in per field,
 * because a recurring item's amount is a positive magnitude in the schema
 * (`amount_cents > 0`) and must not be drivable negative from the UI.
 *
 * All of it runs on `emptyHouseholdPage` (user D) — every test here writes
 * real rows, and user A's household is asserted against exactly by
 * `tests/rls/seed-fidelity.test.ts`. See `tests/e2e/fixtures.ts`.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

/**
 * U+2212, the typographic minus the app renders — not the hyphen a keyboard
 * types. Asserting on the hyphen here would pass against a build that had
 * quietly stopped using the real minus, which is a screen-reader regression
 * (`app/lib/format.ts` explains why).
 */
const MINUS = '−'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('entering an overdrawn balance', () => {
  test('the sign toggle is the way in, and the balance survives the round trip', async ({
    emptyHouseholdPage: page,
  }) => {
    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    await dialog.locator('#account-name').fill('E2E Overdrawn')
    await dialog.locator('#account-balance').fill('1234')

    // This is the iOS path: digits from a numeric keypad, then a tap. No
    // minus key is involved anywhere in it.
    const sign = dialog.getByRole('button', { name: 'Negative amount' })
    await expect(sign).toHaveAttribute('aria-pressed', 'false')
    await sign.click()
    await expect(sign).toHaveAttribute('aria-pressed', 'true')

    // The field holds the magnitude alone — the sign is rendered once, by the
    // toggle, so the control reads `− $ 1234` rather than `− $ -1234`.
    await expect(dialog.locator('#account-balance')).toHaveValue('1234')

    const row = page.getByRole('button', { name: 'Edit E2E Overdrawn' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
    await expect(row).toContainText(`${MINUS}$1,234`)

    // Reopened from the database, not from the form state that wrote it: this
    // is what proves `balance_cents` actually holds -123400 rather than the
    // row merely having been rendered from a value that never persisted.
    await clickUntil(row, dialog)
    await expect(dialog.getByRole('button', { name: 'Negative amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(dialog.locator('#account-balance')).toHaveValue('1234')
  })

  test('does not dismiss the keyboard mid-amount', async ({ emptyHouseholdPage: page }) => {
    // The toggle is pressed *while typing an amount* — that is the only time
    // anyone touches it. A button taking focus would close the iOS keyboard
    // right then, which is the worst possible moment for it.
    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    const balance = dialog.locator('#account-balance')
    // Part-way through an amount, which is the state this is about — a new
    // account's balance starts at 0, so type over it first.
    await balance.fill('75')
    await balance.click()
    await expect(balance).toBeFocused()

    await dialog.getByRole('button', { name: 'Negative amount' }).click()

    await expect(dialog.getByRole('button', { name: 'Negative amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The sign flipped, the caret never left the field, and the digits already
    // typed are untouched.
    await expect(balance).toBeFocused()
    await expect(balance).toHaveValue('75')

    // …and the next keystroke lands in the same field rather than nowhere.
    await page.keyboard.press('End')
    await page.keyboard.type('0')
    await expect(balance).toHaveValue('750')

    await dialog.locator('#account-name').fill('E2E Focus')
    const row = page.getByRole('button', { name: 'Edit E2E Focus' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
    await expect(row).toContainText(`${MINUS}$750`)
  })

  test('a typed minus works too, and lands on the same toggle', async ({
    emptyHouseholdPage: page,
  }) => {
    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    await dialog.locator('#account-name').fill('E2E Typed Minus')
    // The desktop path. Nothing about the toggle makes a keyboard's own minus
    // stop working; the two are edits to one draft string.
    await dialog.locator('#account-balance').fill('-42')

    await expect(dialog.getByRole('button', { name: 'Negative amount' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(dialog.locator('#account-balance')).toHaveValue('42')

    const row = page.getByRole('button', { name: 'Edit E2E Typed Minus' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
    await expect(row).toContainText(`${MINUS}$42`)
  })
})

test.describe('an overdrawn forecast', () => {
  test('the dashboard says the balance goes negative, not just draws it', async ({
    emptyHouseholdPage: page,
  }) => {
    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)
    await dialog.locator('#account-name').fill('E2E Underwater')
    await dialog.locator('#account-balance').fill('1234')
    await dialog.getByRole('button', { name: 'Negative amount' }).click()
    const row = page.getByRole('button', { name: 'Edit E2E Underwater' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)

    await gotoHydrated(page, '/')

    // The chart's own accessible summary. The zero reference line is the
    // visual answer to `docs/design/dashboard/spec.md`'s Open Question 7, and
    // a line conveys nothing to a screen reader, so the same fact is stated
    // in words.
    const chart = page.getByRole('img', { name: /Balance forecast/ })
    await expect(chart).toHaveAttribute('aria-label', /The balance goes negative in this window\./)

    // …and the visual half: the zero line's label, drawn because the range
    // crosses zero while the cushion (user D's $600 default) does not sit on
    // it.
    await expect(page.getByText('$0', { exact: true })).toBeVisible()

    // The figure itself, negative, wherever the dashboard states it.
    await expect(page.getByText(`${MINUS}$1,234`).first()).toBeVisible()
  })
})

test.describe('fields that cannot hold a negative', () => {
  test("a recurring item's amount offers no toggle and drops a typed minus", async ({
    emptyHouseholdPage: page,
  }) => {
    // A bill is stored as a positive magnitude and the sign comes from `kind`
    // at projection time — `amount_cents > 0` in the schema says so too. The
    // digits are kept rather than the entry being zeroed: the user typed them.
    await gotoHydrated(page, '/accounts')
    const accountDialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), accountDialog)
    await accountDialog.locator('#account-name').fill('E2E Positive Only')
    await accountDialog.locator('#account-balance').fill('100')
    const row = page.getByRole('button', { name: 'Edit E2E Positive Only' })
    await clickUntil(accountDialog.getByRole('button', { name: 'Add account' }), row)

    await gotoHydrated(page, '/recurring-items')
    const dialog = page.getByRole('dialog')
    const addTrigger = page
      .getByRole('button', { name: 'Add recurring item' })
      .filter({ visible: true })
      .first()
    await clickUntil(addTrigger, dialog)

    await expect(dialog.getByRole('button', { name: 'Negative amount' })).toHaveCount(0)
    await dialog.locator('#recurring-amount').fill('-300')
    await expect(dialog.locator('#recurring-amount')).toHaveValue('300')
  })
})
