/**
 * The dashboard's account-selection logic — which accounts are drawn, what
 * happens when a legend checkbox changes, and the legend rows themselves.
 *
 * Pure TypeScript, no Vue imports, so it runs under the `unit` test project
 * alongside `burndown.ts`. A new file rather than an addition to that one,
 * deliberately: PR #70 is already growing `burndown.ts` and its test file, and
 * this logic is a different concern — selection, not geometry.
 */

import type { LegendEntry } from '@/lib/burndown'
import type { MinorUnits } from '~~/domain/money'
import type { AccountSeries } from '~~/domain/projection'
import type { Account } from '~~/domain/types'

/** Ids of the accounts whose series is drawn: everything not hidden. */
export function visibleAccountIds(
  accounts: readonly Account[],
  hidden: readonly string[],
): string[] {
  return accounts.filter((account) => !hidden.includes(account.id)).map((account) => account.id)
}

/**
 * The hidden set after a legend checkbox change, or `null` when the change is
 * refused — hiding the last visible account would empty the chart, and an
 * empty chart has nothing to say.
 */
export function nextHiddenAccounts(
  hidden: readonly string[],
  visible: readonly string[],
  accountId: string,
  checked: boolean,
): readonly string[] | null {
  if (checked) return hidden.filter((id) => id !== accountId)
  if (visible.length <= 1) return null
  if (hidden.includes(accountId)) return hidden
  return [...hidden, accountId]
}

/**
 * The window's closing balance per account, taken from the summary
 * `project()` already produced — never by indexing the last point of a
 * series. `project` finds this in the same pass that builds the series; this
 * function only reads what it found.
 */
export function endingBalances(series: readonly AccountSeries[]): ReadonlyMap<string, MinorUnits> {
  return new Map(series.map((entry) => [entry.accountId, entry.summary.ending]))
}

/**
 * One legend row per active account, in `accounts` order.
 *
 * Falls back to `account.balance` when an account has no series entry —
 * today's behaviour, kept for the same reason it existed before: a legend row
 * must always show something rather than nothing. Marks the sole visible
 * account `disabled`, so its checkbox cannot be used to empty the chart.
 */
export function legendEntries(
  accounts: readonly Account[],
  ending: ReadonlyMap<string, MinorUnits>,
  hidden: readonly string[],
): LegendEntry[] {
  const visible = visibleAccountIds(accounts, hidden)
  return accounts.map((account) => ({
    accountId: account.id,
    name: account.name,
    color: account.color,
    endingBalance: ending.get(account.id) ?? account.balance,
    checked: !hidden.includes(account.id),
    disabled: visible.length === 1 && visible[0] === account.id,
  }))
}
