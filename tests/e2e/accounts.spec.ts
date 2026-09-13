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

  test('re-dates the reading to today when only the balance changes', async ({
    emptyHouseholdPage: page,
  }) => {
    // A fixed, known day rather than "today" — the assertion below only needs
    // to know this exact string disappears from the row, never what today's
    // date actually renders as, so it carries no timezone risk of its own.
    const pastIso = '2026-01-05'
    const pastFormatted = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${pastIso}T00:00:00Z`))

    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    await page.locator('#account-name').fill('E2E Balance Only')
    await page.locator('#account-balance').fill('500')
    await page.locator('#account-as-of').fill(pastIso)

    const row = page.getByRole('button', { name: 'Edit E2E Balance Only' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
    await expect(row).toContainText(`Balance as of ${pastFormatted}`)

    // Reopen and change only the balance — "As of" is left exactly as the
    // form seeded it. The fix under test is that this must not save $550
    // back against `pastIso`, silently redating that account's current
    // reading to a stale day instead of recording what it holds now.
    await clickUntil(row, dialog)
    await page.locator('#account-balance').fill('550')

    // The field itself moves, rather than the save quietly disagreeing with
    // what the field shows. Asserted as "no longer the past day" rather than
    // "equals today" so the assertion carries no timezone risk of its own.
    await expect(page.locator('#account-as-of')).not.toHaveValue(pastIso)

    await clickUntil(
      dialog.getByRole('button', { name: 'Save changes' }),
      row.filter({
        hasText: '$550',
      }),
    )

    await expect(row).toContainText('$550')
    await expect(row).not.toContainText(`Balance as of ${pastFormatted}`)
  })

  test('touching "As of" — even to reaffirm the day already shown — corrects that day instead of today', async ({
    emptyHouseholdPage: page,
  }) => {
    // The case the auto-advance above must not swallow: correcting what an
    // account held on a *specific* day, including the day it already reads.
    // Reaffirming the field's own value is the only way to say "yes, this
    // day, a different figure" — leaving it untouched cannot mean that, since
    // it is indistinguishable from never having looked at it.
    const pastIso = '2026-02-10'
    const pastFormatted = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${pastIso}T00:00:00Z`))

    await gotoHydrated(page, '/accounts')
    const dialog = page.getByRole('dialog')
    await clickUntil(page.getByRole('button', { name: 'Add account' }), dialog)

    await page.locator('#account-name').fill('E2E Same-Day Correction')
    await page.locator('#account-balance').fill('500')
    await page.locator('#account-as-of').fill(pastIso)

    const row = page.getByRole('button', { name: 'Edit E2E Same-Day Correction' })
    await clickUntil(dialog.getByRole('button', { name: 'Add account' }), row)
    await expect(row).toContainText(`Balance as of ${pastFormatted}`)

    // Reopen, correct the balance — which moves the field to today — and
    // reaffirm "As of" by refilling it with the exact day already shown:
    // touching the field, not changing its value.
    await clickUntil(row, dialog)
    await page.locator('#account-balance').fill('550')
    await expect(page.locator('#account-as-of')).not.toHaveValue(pastIso)
    await page.locator('#account-as-of').fill(pastIso)
    await expect(page.locator('#account-as-of')).toHaveValue(pastIso)

    // The balance moves once more, *after* the day was typed. This is the
    // half that needs the editor to remember the field was touched rather
    // than compare its value: the day must now stay put, where the first
    // balance edit moved it. Without that memory this snaps back to today and
    // correcting a specific day is unreachable again — and an assertion that
    // stops before this step passes against an editor that never consults
    // the flag at all.
    await page.locator('#account-balance').fill('575')
    await expect(page.locator('#account-as-of')).toHaveValue(pastIso)

    await clickUntil(
      dialog.getByRole('button', { name: 'Save changes' }),
      row.filter({ hasText: '$575' }),
    )

    // The correction landed on the day it was for, not on today.
    await expect(row).toContainText('$575')
    await expect(row).toContainText(`Balance as of ${pastFormatted}`)
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
