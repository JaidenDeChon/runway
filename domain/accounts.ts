/**
 * Invariants over the account collection.
 *
 * These live here rather than in a save handler because the rules must hold no
 * matter which surface writes them — the accounts editor, onboarding, or a
 * future import. A component enforcing them locally is a rule with as many
 * copies as there are callers.
 */

import type { IsoDate } from './dates'
import { compareDates, daysBetween } from './dates'
import type { MinorUnits } from './money'
import type { Account, AccountColor, RecurringItem, Transfer } from './types'
import { ACCOUNT_COLORS } from './types'

/**
 * Makes `accountId` the sole discretionary source.
 *
 * Clearing every other account is the point: the flag is an exclusive
 * selection, and modelling it as a boolean per row means the exclusivity has to
 * be re-established on every write.
 */
export function setDiscretionarySource(accounts: readonly Account[], accountId: string): Account[] {
  return accounts.map((account) => ({
    ...account,
    isDiscretionarySource: account.id === accountId,
  }))
}

/**
 * Applies an edited account, preserving the one-source invariant.
 *
 * Turning the flag *off* on the account that held it leaves the app with no
 * discretionary source at all, which is legal — the daily spend simply has
 * nothing to drain — and is not silently reassigned to another account.
 */
export function upsertAccount(accounts: readonly Account[], edited: Account): Account[] {
  const exists = accounts.some((account) => account.id === edited.id)
  const next = exists
    ? accounts.map((account) => (account.id === edited.id ? edited : account))
    : [...accounts, edited]
  return edited.isDiscretionarySource ? setDiscretionarySource(next, edited.id) : [...next]
}

/** The next account color in round-robin order, so a new account is rarely a duplicate. */
export function nextAccountColor(accounts: readonly Account[]): AccountColor {
  const used = accounts.length % ACCOUNT_COLORS.length
  return ACCOUNT_COLORS[used] ?? 'chart-2'
}

export interface DeleteAccountResult {
  readonly accounts: readonly Account[]
  readonly recurringItems: readonly RecurringItem[]
  readonly transfers: readonly Transfer[]
}

/**
 * Removes an account and everything that pointed at it.
 *
 * The app no longer offers this — the accounts screen archives instead of
 * deleting, so history survives (see `archiveAccount`). This stays because it
 * is pure, tested, and it is the shape of the cascade the *database* still
 * performs if a row is ever hard-deleted; #8 and #9 will need exactly this
 * when rules and transfers move onto Supabase.
 *
 * The design leaves the cascade unspecified. Orphaning is the one option that
 * is definitely wrong — a recurring item with a dangling `accountId` would keep
 * being projected against an account that no longer exists — so dependent
 * records go with it, and the caller is expected to say so before confirming.
 */
export function deleteAccount(
  accounts: readonly Account[],
  recurringItems: readonly RecurringItem[],
  transfers: readonly Transfer[],
  accountId: string,
): DeleteAccountResult {
  return {
    accounts: accounts.filter((account) => account.id !== accountId),
    recurringItems: recurringItems.filter((item) => item.accountId !== accountId),
    transfers: transfers.filter(
      (transfer) => transfer.fromAccountId !== accountId && transfer.toAccountId !== accountId,
    ),
  }
}

/** What deleting `accountId` would take with it, for the confirmation copy. */
export function countDependents(
  recurringItems: readonly RecurringItem[],
  transfers: readonly Transfer[],
  accountId: string,
): { readonly items: number; readonly transfers: number } {
  return {
    items: recurringItems.filter((item) => item.accountId === accountId).length,
    transfers: transfers.filter(
      (transfer) => transfer.fromAccountId === accountId || transfer.toAccountId === accountId,
    ).length,
  }
}

/** Whether `account` is archived — has an `archivedOn` day rather than being active. */
export function isArchived(account: Account): boolean {
  return account.archivedOn !== undefined
}

/** The active subset, in the order given. */
export function activeAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => !isArchived(account))
}

/** Archived accounts, most recently archived first, then by id for stability. */
export function archivedAccounts(accounts: readonly Account[]): Account[] {
  return accounts
    .filter(isArchived)
    .sort(
      (a, b) =>
        compareDates(b.archivedOn as IsoDate, a.archivedOn as IsoDate) || a.id.localeCompare(b.id),
    )
}

/**
 * Archives one account, clearing its discretionary flag.
 *
 * The flag is not reassigned: leaving the household with no discretionary
 * source is legal (`upsertAccount` already takes that stance) and silently
 * moving the drain to another account would be a change the user did not make.
 * A no-op when `accountId` is not found.
 */
export function archiveAccount(
  accounts: readonly Account[],
  accountId: string,
  on: IsoDate,
): Account[] {
  return accounts.map((account) =>
    account.id === accountId
      ? { ...account, archivedOn: on, isDiscretionarySource: false }
      : account,
  )
}

/** Restores an archived account. It comes back inactive as a discretionary source. */
export function restoreAccount(accounts: readonly Account[], accountId: string): Account[] {
  return accounts.map((account) => {
    if (account.id !== accountId) return account
    const { archivedOn: _archivedOn, ...restored } = account
    return restored
  })
}

/** Active accounts already drawn in `color`, excluding `exceptId`. Ordered as given. */
export function accountsUsingColor(
  accounts: readonly Account[],
  color: AccountColor,
  exceptId?: string,
): Account[] {
  return activeAccounts(accounts).filter(
    (account) => account.color === color && account.id !== exceptId,
  )
}

/** Two weeks: about how long a hand-typed balance goes on describing today. */
export const DEFAULT_STALE_AFTER_DAYS = 14

/** A sanity range, not a menu — see `default_horizon_days` in `docs/database/schema.md`. */
export const STALE_AFTER_DAYS_BOUNDS = { min: 1, max: 365 } as const

export interface AnchorAge {
  readonly accountId: string
  readonly asOf: IsoDate
  /** `daysBetween(asOf, today)`. Negative when the reading is dated in the future. */
  readonly ageDays: number
  readonly isStale: boolean
}

/**
 * **This is the *absolute* staleness question, and it is not the one
 * `balanceReadings` answers.** `balanceReadings` measures *relative* drift
 * between accounts (is the household's picture internally consistent?), which
 * is already surfaced on the row and in `StaleBalancesAlert`. `anchorAges`
 * measures *absolute* age against `today` (is this number still true?). Both
 * are projection-quality facts; both live here; neither replaces the other.
 */

/** Every active account's anchor age, in the order given. Archived accounts are excluded. */
export function anchorAges(
  accounts: readonly Account[],
  today: IsoDate,
  staleAfterDays: number,
): AnchorAge[] {
  return activeAccounts(accounts).map((account) => {
    const ageDays = daysBetween(account.balanceAsOf, today)
    return {
      accountId: account.id,
      asOf: account.balanceAsOf,
      ageDays,
      // Strictly greater: a threshold of 14 flags on day 15, not day 14. A
      // reading dated in the future gives a negative age and is never stale.
      isStale: ageDays > staleAfterDays,
    }
  })
}

/** Only the stale ones, oldest first, then by accountId. */
export function staleAnchors(
  accounts: readonly Account[],
  today: IsoDate,
  staleAfterDays: number,
): AnchorAge[] {
  return anchorAges(accounts, today, staleAfterDays)
    .filter((entry) => entry.isStale)
    .sort((a, b) => b.ageDays - a.ageDays || a.accountId.localeCompare(b.accountId))
}

/** One account whose balance was last read before the others were. */
export interface StaleReading {
  readonly accountId: string
  readonly asOf: IsoDate
  /** How far behind the most recent reading this one is. Always at least 1. */
  readonly daysBehind: number
}

export interface BalanceReadings {
  /** The most recent `balanceAsOf` across the accounts; `null` when there are none. */
  readonly newest: IsoDate | null
  readonly oldest: IsoDate | null
  /** Accounts read before `newest`, furthest behind first. */
  readonly stale: readonly StaleReading[]
  /** Days between the oldest and newest reading. `0` when they agree. */
  readonly spreadDays: number
  /** Every account was last read on the same day. Vacuously true for none. */
  readonly isConsistent: boolean
}

/**
 * How far the accounts' balance readings have drifted apart.
 *
 * This is a projection-quality fact, not a presentation one, which is why it
 * lives here: a stored balance is true *as of* its own day and already contains
 * everything up to it, so readings taken on different days do not describe one
 * moment. The visible consequence is that recording a transfer between two
 * such accounts moves the combined line — correctly, and bafflingly, because
 * the transfer is inside one reading and not the other. See the worked example
 * in `projection.test.ts`.
 *
 * The engine does not consult this. It projects what it is given; this is how a
 * screen can tell the user that what it was given disagrees with itself.
 */
export function balanceReadings(accounts: readonly Account[]): BalanceReadings {
  if (accounts.length === 0) {
    return { newest: null, oldest: null, stale: [], spreadDays: 0, isConsistent: true }
  }

  let newest = accounts[0]?.balanceAsOf as IsoDate
  let oldest = newest
  for (const account of accounts) {
    if (compareDates(account.balanceAsOf, newest) > 0) newest = account.balanceAsOf
    if (compareDates(account.balanceAsOf, oldest) < 0) oldest = account.balanceAsOf
  }

  const stale = accounts
    .filter((account) => account.balanceAsOf !== newest)
    .map((account) => ({
      accountId: account.id,
      asOf: account.balanceAsOf,
      daysBehind: daysBetween(account.balanceAsOf, newest),
    }))
    .sort((a, b) => b.daysBehind - a.daysBehind || a.accountId.localeCompare(b.accountId))

  return {
    newest,
    oldest,
    stale,
    spreadDays: daysBetween(oldest, newest),
    isConsistent: stale.length === 0,
  }
}

/** A balance observed for one account. */
export interface BalanceReading {
  readonly accountId: string
  readonly balance: MinorUnits
}

/**
 * Records balances observed on `asOf`, leaving untouched accounts alone.
 *
 * **This is the seam for automatic balance refresh.** Whatever eventually
 * supplies readings — a bank connection, an import, a scheduled job — hands the
 * same `{ accountId, balance }[]` and the same `asOf` to this function, and
 * every screen that reads `balanceAsOf` updates without knowing where the
 * numbers came from. Keeping the shape identical to what the manual editor
 * produces is the point: an automatic source should be a different *caller*,
 * not a different code path, or the two will drift and only one of them will be
 * tested.
 *
 * A reading naming an account that does not exist is ignored rather than
 * inserted — a stale sync must not resurrect a deleted account.
 */
export function applyBalanceReadings(
  accounts: readonly Account[],
  readings: readonly BalanceReading[],
  asOf: IsoDate,
): Account[] {
  const byId = new Map(readings.map((reading) => [reading.accountId, reading.balance]))
  return accounts.map((account) => {
    const balance = byId.get(account.id)
    return balance === undefined ? account : { ...account, balance, balanceAsOf: asOf }
  })
}
