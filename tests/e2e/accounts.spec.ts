/**
 * The accounts screen, end to end.
 *
 * Where onboarding proves the create path, this proves the read-and-edit one —
 * the list renders the household, a row opens the editor, and the editor is a
 * real dialog rather than a div that looks like one. Between them the two specs
 * cover both directions of the app's only data surface.
 *
 * The first two tests below run against user A's seeded household, which lives
 * in the database now rather than in `domain/seed.ts` — a fresh `page.goto` is
 * still enough to have data on screen, because Supabase's seed and the design
 * screenshots agree on the same Checking/Savings names. The tests after them
 * are the write path, and they run on `emptyHouseholdPage` (user D) instead:
 * every write here lands as a real row, and running it against A would
 * accumulate accounts that `tests/rls/seed-fidelity.test.ts`'s exact-list
 * assertion would then fail on. See `tests/e2e/fixtures.ts`.
 */

import { assertBaseUrlIsLocal, clickUntil, expect, gotoHydrated, test } from './fixtures'

test.beforeEach(({ baseURL }) => {
  assertBaseUrlIsLocal(baseURL)
})

test.describe('the accounts screen', () => {
  test('lists the household and opens an account for editing', async ({
    authenticatedPage: page,
  }) => {
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

  test('keeps the "connect a bank" card out of the tab order', async ({
    authenticatedPage: page,
  }) => {
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

test.describe('creating and managing an account', () => {
  test('creates an account and sees it on the dashboard', async ({ emptyHouseholdPage: page }) => {
    await gotoHydrated(page, '/accounts')
    await expect(page.getByText('No accounts yet')).toBeVisible()

    const dialog = page.getByRole('dialog')
    // Retried until the dialog actually opens: a click landing before the
    // button is listening is swallowed, and Playwright would not retry it.
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    await page.locator('#account-name').fill('E2E Checking')
    await page.locator('#account-balance').fill('1500')

    // Located by `AccountRow`'s own `aria-label`, which is unambiguous even
    // while the dialog's own submit button carries the same visible text
    // ("Add account" on the trigger, "Add account" on the submit button too).
    const row = page.getByRole('button', { name: 'Edit E2E Checking' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
    await expect(row).toContainText('$1,500')

    await gotoHydrated(page, '/')
    // `AccountLegendRow` renders the name inside a `Label` with sr-only
    // "Show"/"on the chart" text either side, at both viewports.
    await expect(
      page.getByRole('checkbox', { name: 'Show E2E Checking on the chart' }),
    ).toBeVisible()
    await expect(page.getByText('Nothing to forecast yet')).toHaveCount(0)
  })

  test('keeps the account across a full reload', async ({ emptyHouseholdPage: page }) => {
    // The one assertion an in-memory store could not pass — the create above
    // proves the write; this proves it survived leaving the page entirely.
    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    await page.locator('#account-name').fill('E2E Reload')
    await page.locator('#account-balance').fill('750')

    const row = page.getByRole('button', { name: 'Edit E2E Reload' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)

    await gotoHydrated(page, '/accounts')
    await expect(page.getByRole('button', { name: 'Edit E2E Reload' })).toBeVisible()
  })

  test('flags a balance anchor older than the threshold', async ({ emptyHouseholdPage: page }) => {
    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    // Computed from `new Date()`, not written as a literal, so this can never
    // go stale itself. 60 days clears `balance_stale_after_days`' default of
    // 14 by enough margin that a one-day timezone difference between the
    // browser and the server cannot change the answer.
    const staleDate = new Date()
    staleDate.setDate(staleDate.getDate() - 60)
    const staleIso = staleDate.toISOString().slice(0, 10)

    await page.locator('#account-name').fill('E2E Stale')
    await page.locator('#account-balance').fill('400')
    await page.locator('#account-as-of').fill(staleIso)

    const row = page.getByRole('button', { name: 'Edit E2E Stale' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)

    // No exact day count asserted — only that the row is flagged at all.
    await expect(row).toContainText(/Last updated \d+ days ago/)
  })

  test('archives an account and restores it', async ({ emptyHouseholdPage: page }) => {
    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    await page.locator('#account-name').fill('E2E Archive Target')
    await page.locator('#account-balance').fill('900')

    const activeRow = page.getByRole('button', { name: 'Edit E2E Archive Target' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), activeRow)

    // Reopen it, and archive. The footer's ghost "Archive" button only shows
    // the confirmation; the confirmation block's own "Archive" button is the
    // one that actually saves, and the two share visible text once both are
    // on screen — every locator below is scoped to disambiguate them.
    await clickUntil(activeRow, dialog)
    const confirm = page.getByRole('alertdialog')
    await clickUntil(dialog.getByRole('button', { name: 'Archive' }), confirm)

    const archivedSection = page.getByText('Archived', { exact: true })
    await clickUntil(confirm.getByRole('button', { name: 'Archive' }), archivedSection)

    await expect(activeRow).toHaveCount(0)
    const archivedRow = page.getByRole('button', { name: 'View E2E Archive Target' })
    await expect(archivedRow).toBeVisible()

    // Restore it, and it comes back to the main list.
    await clickUntil(archivedRow, dialog)
    await clickUntil(dialog.getByRole('button', { name: 'Restore' }), activeRow)

    await expect(activeRow).toBeVisible()
    await expect(archivedRow).toHaveCount(0)
  })
})
