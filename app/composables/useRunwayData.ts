/**
 * The app's single copy of the user's financial data.
 *
 * Dummy data for now: seeded in memory, lost on reload. Everything downstream —
 * every screen, every projection — reads from here, so replacing this with a
 * real store means changing this file and nothing else. The mutation surface
 * below is deliberately the shape a persistence layer would need.
 *
 * All mutations delegate their *rules* to `domain/`; this composable only holds
 * state and generates ids.
 */

import {
  deleteAccount as domainDeleteAccount,
  upsertAccount as domainUpsertAccount,
} from '~~/domain/accounts'
import { resolveAmount } from '~~/domain/prediction'
import { createSeedData } from '~~/domain/seed'
import type { Account, RecurringItem, RunwayData, Transfer } from '~~/domain/types'
import type { MinorUnits } from '~~/domain/money'

/**
 * Ids are generated here rather than in the domain because they are a storage
 * concern — a real backend would assign them.
 */
function createId(prefix: string): string {
  const globalCrypto = globalThis.crypto
  const unique =
    typeof globalCrypto?.randomUUID === 'function'
      ? globalCrypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
  return `${prefix}-${unique}`
}

export function useRunwayData() {
  // `useState` rather than a module-level ref: it is SSR-safe and gives each
  // request its own copy, so one visitor's edits cannot leak into another's.
  const data = useState<RunwayData>('runway-data', () => createSeedData())

  const accounts = computed(() => data.value.accounts)
  const recurringItems = computed(() => data.value.recurringItems)
  const transfers = computed(() => data.value.transfers)
  const safetyCushion = computed(() => data.value.safetyCushion)

  const accountsById = computed(
    () => new Map(data.value.accounts.map((account) => [account.id, account])),
  )

  function accountName(accountId: string): string {
    return accountsById.value.get(accountId)?.name ?? 'Unknown account'
  }

  function saveAccount(account: Omit<Account, 'id'> & { id?: string }): Account {
    const saved: Account = { ...account, id: account.id ?? createId('acct') }
    data.value = { ...data.value, accounts: domainUpsertAccount(data.value.accounts, saved) }
    return saved
  }

  /**
   * Removes an account together with the recurring items and transfers that
   * referenced it — see `domain/accounts.ts` for why orphaning is not an option.
   */
  function removeAccount(accountId: string): void {
    const result = domainDeleteAccount(
      data.value.accounts,
      data.value.recurringItems,
      data.value.transfers,
      accountId,
    )
    data.value = { ...data.value, ...result }
  }

  function saveRecurringItem(item: Omit<RecurringItem, 'id'> & { id?: string }): RecurringItem {
    const withId: RecurringItem = { ...item, id: item.id ?? createId('item') }
    // Prediction is resolved at save time, not at render time, so the row and
    // the projection always read one stored figure.
    const saved: RecurringItem = { ...withId, amount: resolveAmount(withId) }
    const exists = data.value.recurringItems.some((existing) => existing.id === saved.id)
    data.value = {
      ...data.value,
      recurringItems: exists
        ? data.value.recurringItems.map((existing) => (existing.id === saved.id ? saved : existing))
        : [...data.value.recurringItems, saved],
    }
    return saved
  }

  function removeRecurringItem(itemId: string): void {
    data.value = {
      ...data.value,
      recurringItems: data.value.recurringItems.filter((item) => item.id !== itemId),
    }
  }

  function addTransfer(transfer: Omit<Transfer, 'id' | 'createdAt'>): Transfer {
    const saved: Transfer = {
      ...transfer,
      id: createId('xfer'),
      // Monotonic within a session; only ever used to break same-day ties.
      createdAt: data.value.transfers.length + 1,
    }
    data.value = { ...data.value, transfers: [...data.value.transfers, saved] }
    return saved
  }

  function setSafetyCushion(cushion: MinorUnits): void {
    data.value = { ...data.value, safetyCushion: Math.max(0, Math.round(cushion)) }
  }

  function setDailyDiscretionarySpend(amount: MinorUnits): void {
    data.value = {
      ...data.value,
      dailyDiscretionarySpend: Math.max(0, Math.round(amount)),
    }
  }

  /**
   * Drops every record, leaving the settings alone.
   *
   * Onboarding needs a blank slate to build onto: with seeded data present, the
   * first-run flow would be adding a second account, not a first one.
   */
  function clearRecords(): void {
    data.value = { ...data.value, accounts: [], recurringItems: [], transfers: [] }
  }

  /** True when the user has nothing to project from — the "skipped onboarding" case. */
  const isEmpty = computed(() => data.value.accounts.length === 0)

  return {
    data,
    accounts,
    accountsById,
    recurringItems,
    transfers,
    safetyCushion,
    isEmpty,
    accountName,
    saveAccount,
    removeAccount,
    saveRecurringItem,
    removeRecurringItem,
    addTransfer,
    setSafetyCushion,
    setDailyDiscretionarySpend,
    clearRecords,
  }
}
