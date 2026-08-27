/**
 * The app's single copy of the user's financial data.
 *
 * Dummy data for now: seeded in memory, lost on reload. Everything downstream —
 * every screen, every projection — reads from here, so replacing this with a
 * real store means changing this file and nothing else. The mutation surface
 * below is deliberately the shape a persistence layer would need.
 *
 * The store it is waiting for is **Supabase behind sign-in**, not the browser.
 * Persisting to `localStorage` first was considered and dropped: authentication
 * is the next feature, and a storage layer it would immediately replace is work
 * done twice. Reloading loses your edits until then, deliberately.
 *
 * All mutations delegate their *rules* to `domain/`; this composable only holds
 * state and generates ids.
 */

import type { BalanceReading } from '~~/domain/accounts'
import {
  applyBalanceReadings,
  deleteAccount as domainDeleteAccount,
  upsertAccount as domainUpsertAccount,
} from '~~/domain/accounts'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import { resolveAmount } from '~~/domain/prediction'
import { createSeedData } from '~~/domain/seed'
import type { Account, RecurringItem, RunwayData, Transfer } from '~~/domain/types'

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
  /**
   * The user's stored timezone *override*, not their effective zone. `null`
   * means "follow the device", which `useTimeZone` resolves — a device-derived
   * zone is a fact about a device and does not belong in the user's data.
   */
  const timeZoneOverride = computed(() => data.value.timeZone)

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
   * Records observed balances against `asOf`, for every account reported.
   *
   * The one entry point for "here is what these accounts hold now", whether the
   * numbers came from the user typing them or, later, from a bank connection.
   * Both hand the same readings to the same domain function — an automatic
   * source should be a different caller, not a second code path.
   */
  function saveBalances(readings: readonly BalanceReading[], asOf: IsoDate): void {
    data.value = {
      ...data.value,
      accounts: applyBalanceReadings(data.value.accounts, readings, asOf),
    }
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
      // Epoch milliseconds, which is what `transfers.created_at` maps to (see
      // the mapping table in docs/database/schema.md). It was the transfer
      // count, which is monotonic only within one session: once rows are loaded
      // from storage rather than built from scratch, a count restarts and two
      // transfers can claim the same tie-breaker. Reading the clock is fine
      // here and only here — the domain never does it.
      createdAt: Date.now(),
    }
    data.value = { ...data.value, transfers: [...data.value.transfers, saved] }
    return saved
  }

  function setSafetyCushion(cushion: MinorUnits): void {
    data.value = { ...data.value, safetyCushion: Math.max(0, Math.round(cushion)) }
  }

  /** Pass `null` to go back to following the device. */
  function setTimeZoneOverride(timeZone: string | null): void {
    data.value = { ...data.value, timeZone: timeZone?.trim() || null }
  }

  function setMonthlyDiscretionarySpend(amount: MinorUnits): void {
    data.value = {
      ...data.value,
      monthlyDiscretionarySpend: Math.max(0, Math.round(amount)),
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
    timeZoneOverride,
    isEmpty,
    accountName,
    saveAccount,
    saveBalances,
    removeAccount,
    saveRecurringItem,
    removeRecurringItem,
    addTransfer,
    setSafetyCushion,
    setTimeZoneOverride,
    setMonthlyDiscretionarySpend,
    clearRecords,
  }
}
