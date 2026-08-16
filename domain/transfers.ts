/**
 * Transfer rules.
 *
 * A transfer relocates a balance; it is neither income nor spending, and the
 * combined projection must be identical with and without it. That property is
 * structural — `projection.ts` writes both legs from this single record — and
 * is asserted directly in the tests.
 */

import { compareDates } from './dates'
import type { Account, Transfer } from './types'

export type TransferProblem = 'same-account' | 'non-positive-amount'

export interface TransferDraft {
  readonly fromAccountId: string
  readonly toAccountId: string
  readonly amount: number
}

/**
 * Why a draft cannot be submitted, in the order the UI should surface them.
 *
 * Returns every problem rather than the first, so a form can explain the
 * amount *and* the account clash at once instead of revealing them one at a
 * time as each is fixed.
 */
export function validateTransfer(draft: TransferDraft): TransferProblem[] {
  const problems: TransferProblem[] = []
  if (draft.fromAccountId === draft.toAccountId) problems.push('same-account')
  if (!(draft.amount > 0)) problems.push('non-positive-amount')
  return problems
}

export function canSubmitTransfer(draft: TransferDraft): boolean {
  return validateTransfer(draft).length === 0
}

/**
 * The destination to switch to when the user picks a `from` that is already the
 * `to`. Picks the first other account, matching the design; returns null when
 * there is no other account to move to.
 */
export function resolveCounterAccount(
  accounts: readonly Account[],
  fromAccountId: string,
): string | null {
  return accounts.find((account) => account.id !== fromAccountId)?.id ?? null
}

/**
 * Newest first, with `createdAt` breaking same-day ties.
 *
 * A real sort rather than a prepend: back-dating a transfer must place it by
 * its date, not by when it happened to be entered.
 */
export function sortTransfers(transfers: readonly Transfer[]): Transfer[] {
  return [...transfers].sort((a, b) => compareDates(b.date, a.date) || b.createdAt - a.createdAt)
}
