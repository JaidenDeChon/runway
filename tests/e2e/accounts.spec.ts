/**
 * The accounts screen, end to end.
 *
 * Where onboarding proves the create path, this proves the read-and-edit one —
 * the list renders the household, a row opens the editor, and the editor is a
 * real dialog rather than a div that looks like one. Between them the two specs
 * cover both directions of the app's only data surface.
 *
 * The household is `domain/seed.ts` for now, which is why a fresh `page.goto`
 * is enough to have data on screen. When the app reads the database, this spec
 * changes one line — the fixture it seeds from — and not its assertions.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('the accounts screen', () => {
  test('lists the household and opens an account for editing', async ({ page }) => {
    await gotoHydrated(page, '/accounts')

    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible()
    await expect(page.getByText('Checking', { exact: true })).toBeVisible()
    await expect(page.getByText('Savings', { exact: true })).toBeVisible()

    // Retried until the editor actually opens: a click landing before the row
    // is listening is swallowed, and Playwright would not retry it on its own.
    await clickUntil(page.getByText('Checking', { exact: true }), page.getByRole('dialog'))

    // Asserted on the dialog itself, not on a heading matching /account/i —
    // the page's own `<h1>Accounts</h1>` matches that too, so the original
    // form of this check would have passed whether or not the editor ever
    // opened. `ResponsiveEditor` is a Dialog on desktop and a Sheet on mobile
    // and both carry `role="dialog"`, so this holds for either without
    // asserting which one rendered.
    const editor = page.getByRole('dialog')
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('Edit account')
  })

  test('keeps the "connect a bank" card out of the tab order', async ({ page }) => {
    await gotoHydrated(page, '/accounts')

    // Scoped to the card itself rather than to the first `aria-disabled`
    // element on the page — at 375px that was matching something else entirely,
    // which is the kind of pass-for-the-wrong-reason a viewport project exists
    // to catch.
    const card = page.locator('[aria-disabled="true"]').filter({ hasText: 'Connect a bank' })
    await expect(card).toBeVisible()
    // Inert by design — not merely dimmed. A focusable placeholder is a trap
    // for keyboard users, so this is a real requirement and not decoration.
    await expect(card).toHaveAttribute('aria-disabled', 'true')
  })
})
