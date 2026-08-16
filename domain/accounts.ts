/**
 * Invariants over the account collection.
 *
 * These live here rather than in a save handler because the rules must hold no
 * matter which surface writes them — the accounts editor, onboarding, or a
 * future import. A component enforcing them locally is a rule with as many
 * copies as there are callers.
 */

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
