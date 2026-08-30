/**
 * The app's single copy of the user's financial data.
 *
 * **Accounts and settings are Supabase-backed; recurring items and transfers
 * are not yet.** Issue #7 moved the accounts screen onto real rows —
 * `RunwayData.accounts` and the settings that ride along with them
 * (`safetyCushion`, `monthlyDiscretionarySpend`, `timeZone`,
 * `staleAfterDays`) come from `public.accounts` and `public.user_settings`
 * under the signed-in user's own session. Recurring items and transfers stay
 * session-local `useState` — issues #8 and #9 own moving those — and start
 * **empty** rather than from `domain/seed.ts`: a seeded recurring item carries
 * an `accountId` like `'acct-checking'`, which dangles against the account
 * uuids the database actually holds, and the projection would silently bill
 * an account that does not exist.
 *
 * This file is the seam. Every mutation lives here so a screen never reaches
 * around it to talk to Supabase directly, and RLS — not this file — is what
 * actually stops a cross-user read or write; see `docs/auth.md` and
 * `docs/database/rls.md`.
 */

import { useAuthUser, useSupabaseClient } from '@/composables/useAuth'
import type { HouseholdSettings } from '@/lib/supabase/accounts'
import {
  ACCOUNT_COLUMNS,
  type AccountDraft,
  toAccount,
  toAccountColumns,
  toHouseholdSettings,
  USER_SETTINGS_COLUMNS,
} from '@/lib/supabase/accounts'
import type { BalanceReading } from '~~/domain/accounts'
import { activeAccounts, archivedAccounts } from '~~/domain/accounts'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import { resolveAmount } from '~~/domain/prediction'
import type { Account, RecurringItem, RunwayData, Transfer } from '~~/domain/types'

export type { AccountDraft }

interface RemoteHousehold {
  readonly accounts: readonly Account[]
  readonly settings: HouseholdSettings
}

/** What an anonymous visitor, or a request with no session, sees. */
const EMPTY_HOUSEHOLD: RemoteHousehold = { accounts: [], settings: toHouseholdSettings(null) }

interface LocalRecords {
  readonly recurringItems: readonly RecurringItem[]
  readonly transfers: readonly Transfer[]
}

/**
 * Ids are generated here rather than in the domain because they are a storage
 * concern — a real backend would assign them. Still used for recurring items
 * and transfers; accounts get their id from `accounts.id`'s database default.
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
  const client = useSupabaseClient()
  const authUser = useAuthUser()

  // `useAsyncData` rather than a plugin-driven `useState`: it dedupes across
  // the many components that call this composable, it runs on the server
  // through the request-scoped client (`app/plugins/supabase.server.ts`) and
  // transfers its payload to the client, and `watch: [authUser]` re-fetches on
  // sign-in/sign-out. Every call site is at `<script setup>` top level, which
  // is where `useAsyncData` must be called.
  const {
    data: remote,
    pending,
    error,
    refresh,
  } = useAsyncData<RemoteHousehold>(
    'runway-household',
    async () => {
      if (!authUser.value) return EMPTY_HOUSEHOLD
      const [accountsResult, settingsResult] = await Promise.all([
        client
          .from('accounts')
          .select(ACCOUNT_COLUMNS)
          // The seeded Checking/Savings rows share a created_at; id breaks the
          // tie in the order the design draws them.
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
        client.from('user_settings').select(USER_SETTINGS_COLUMNS).maybeSingle(),
      ])
      // The database's own error message can name columns, constraints and
      // policies. It goes nowhere near the UI, and nothing but the code is
      // logged — see CLAUDE.md on what must never reach a log.
      if (accountsResult.error) {
        console.error('accounts read failed', { code: accountsResult.error.code })
        throw new Error('load-failed')
      }
      if (settingsResult.error) {
        console.error('settings read failed', { code: settingsResult.error.code })
        throw new Error('load-failed')
      }
      const settings = toHouseholdSettings(settingsResult.data)
      return {
        accounts: (accountsResult.data ?? []).map((row) =>
          toAccount(row, settings.discretionaryAccountId),
        ),
        settings,
      }
    },
    { default: () => EMPTY_HOUSEHOLD, watch: [authUser] },
  )

  // Recurring items and transfers are still held in memory and lost on
  // reload — issues #8 and #9 own moving them onto Supabase. See the file
  // comment for why they start empty rather than from `domain/seed.ts`.
  const localRecords = useState<LocalRecords>('runway-local-records', () => ({
    recurringItems: [],
    transfers: [],
  }))

  // Settings this screen reads but has no UI to write yet:
  // `cushion_cents`, `monthly_discretionary_cents` and `time_zone` ride along
  // on the one `user_settings` query the discretionary designation already
  // requires — a plain read, always. Their setters below write into this
  // session-local overlay instead of the database, exactly the stance
  // `docs/database/schema.md` already records for `time_zone`: the writer
  // waits for the settings screen. No screen calls these setters today.
  const settingsOverride = useState<Partial<HouseholdSettings>>(
    'runway-settings-override',
    () => ({}),
  )

  const accountsById = computed(
    () => new Map(remote.value.accounts.map((account) => [account.id, account])),
  )

  /** Active accounts, in creation order. */
  const accounts = computed(() => activeAccounts(remote.value.accounts))
  /** Archived accounts, most recently archived first. */
  const archived = computed(() => archivedAccounts(remote.value.accounts))

  const recurringItems = computed(() => localRecords.value.recurringItems)
  const transfers = computed(() => localRecords.value.transfers)

  const safetyCushion = computed(
    () => settingsOverride.value.safetyCushion ?? remote.value.settings.safetyCushion,
  )
  const monthlyDiscretionarySpend = computed(
    () =>
      settingsOverride.value.monthlyDiscretionarySpend ??
      remote.value.settings.monthlyDiscretionarySpend,
  )
  /**
   * The user's stored timezone *override*, not their effective zone. `null`
   * means "follow the device", which `useTimeZone` resolves — a device-derived
   * zone is a fact about a device and does not belong in the user's data.
   *
   * **Do not call `useToday()` or `useTimeZone()` from this file.**
   * `useToday` -> `useTimeZone` -> `useRunwayData` already, and closing that
   * loop is a circular import. Staleness against `today` is computed by the
   * *page*, which already has `today` and reads `staleAfterDays` from here.
   */
  const timeZoneOverride = computed(() =>
    'timeZone' in settingsOverride.value
      ? (settingsOverride.value.timeZone ?? null)
      : remote.value.settings.timeZone,
  )
  const staleAfterDays = computed(() => remote.value.settings.staleAfterDays)

  const isLoading = computed(() => pending.value)
  /** Fixed copy, never a database message — see the read failure above. */
  const loadError = computed(() => (error.value ? 'Could not load your accounts.' : null))

  const data = computed<RunwayData>(() => ({
    accounts: accounts.value,
    recurringItems: recurringItems.value,
    transfers: transfers.value,
    monthlyDiscretionarySpend: monthlyDiscretionarySpend.value,
    safetyCushion: safetyCushion.value,
    timeZone: timeZoneOverride.value,
  }))

  function accountName(accountId: string): string {
    return accountsById.value.get(accountId)?.name ?? 'Unknown account'
  }

  function requireUserId(): string {
    const id = authUser.value?.id
    if (!id) throw new Error('not-authenticated')
    return id
  }

  /**
   * Inserts or updates an account, then re-establishes the one-source
   * discretionary invariant, then refreshes.
   *
   * No optimistic update: two small selects are cheaper than a client-side
   * guess that can disagree with the database, and every mutation here takes
   * the same stance.
   */
  async function saveAccount(draft: AccountDraft): Promise<Account> {
    const userId = requireUserId()
    const columns = toAccountColumns(draft)
    let id = draft.id

    if (id) {
      const { error: updateError } = await client
        .from('accounts')
        .update(columns)
        // `.eq('user_id', ...)` is for the planner and the reader — RLS is
        // what actually scopes this, same as server/api/user-settings.get.ts.
        .eq('id', id)
        .eq('user_id', userId)
      if (updateError) {
        console.error('account update failed', { code: updateError.code })
        throw new Error('save-failed')
      }
    } else {
      const { data: inserted, error: insertError } = await client
        .from('accounts')
        .insert({ ...columns, user_id: userId })
        .select('id')
        .single()
      if (insertError || !inserted) {
        console.error('account insert failed', { code: insertError?.code })
        throw new Error('save-failed')
      }
      id = inserted.id
    }

    // The flag is not reassigned when turned off: leaving the household with
    // no discretionary source is legal (mirrors domain/accounts.ts
    // upsertAccount), and silently moving the drain to another account would
    // be a change the user did not make.
    if (draft.isDiscretionarySource) {
      const { error: settingsError } = await client
        .from('user_settings')
        .update({ discretionary_account_id: id })
        .eq('user_id', userId)
      if (settingsError) {
        console.error('settings update failed', { code: settingsError.code })
        throw new Error('save-failed')
      }
    } else if (remote.value.settings.discretionaryAccountId === id) {
      const { error: settingsError } = await client
        .from('user_settings')
        .update({ discretionary_account_id: null })
        .eq('user_id', userId)
      if (settingsError) {
        console.error('settings update failed', { code: settingsError.code })
        throw new Error('save-failed')
      }
    }

    await refresh()
    const saved = remote.value.accounts.find((account) => account.id === id)
    if (!saved) throw new Error('save-failed')
    return saved
  }

  /**
   * Records balances observed on `asOf`, one update per reading, in
   * `Promise.all`.
   *
   * Readings naming an unknown or archived account are dropped, mirroring
   * `domain/accounts.ts` `applyBalanceReadings`. **Not atomic across
   * accounts** — a partial failure throws and the subsequent `refresh()`
   * shows exactly what actually landed. A transaction would need an RPC in
   * `private`, which is more machinery than a hand-typed balance refresh
   * justifies.
   */
  async function saveBalances(readings: readonly BalanceReading[], asOf: IsoDate): Promise<void> {
    const userId = requireUserId()
    const activeIds = new Set(accounts.value.map((account) => account.id))
    const applicable = readings.filter((reading) => activeIds.has(reading.accountId))

    await Promise.all(
      applicable.map(async (reading) => {
        const { error: updateError } = await client
          .from('accounts')
          .update({ balance_cents: reading.balance, balance_as_of: asOf })
          .eq('id', reading.accountId)
          .eq('user_id', userId)
        if (updateError) {
          console.error('balance update failed', { code: updateError.code })
          throw new Error('save-failed')
        }
      }),
    )
    await refresh()
  }

  /**
   * Archives an account. The database trigger
   * (`private.clear_discretionary_source_on_archive`) clears the
   * discretionary designation if this account held it — the app does not
   * need to.
   */
  async function archiveAccount(accountId: string, on: IsoDate): Promise<void> {
    const userId = requireUserId()
    const { error: archiveError } = await client
      .from('accounts')
      .update({ archived_on: on })
      .eq('id', accountId)
      .eq('user_id', userId)
    if (archiveError) {
      console.error('account archive failed', { code: archiveError.code })
      throw new Error('save-failed')
    }
    await refresh()
  }

  /** Restores an archived account. It comes back holding no discretionary designation. */
  async function restoreAccount(accountId: string): Promise<void> {
    const userId = requireUserId()
    const { error: restoreError } = await client
      .from('accounts')
      .update({ archived_on: null })
      .eq('id', accountId)
      .eq('user_id', userId)
    if (restoreError) {
      console.error('account restore failed', { code: restoreError.code })
      throw new Error('save-failed')
    }
    await refresh()
  }

  function saveRecurringItem(item: Omit<RecurringItem, 'id'> & { id?: string }): RecurringItem {
    const withId: RecurringItem = { ...item, id: item.id ?? createId('item') }
    // Prediction is resolved at save time, not at render time, so the row and
    // the projection always read one stored figure.
    const saved: RecurringItem = { ...withId, amount: resolveAmount(withId) }
    const exists = localRecords.value.recurringItems.some((existing) => existing.id === saved.id)
    localRecords.value = {
      ...localRecords.value,
      recurringItems: exists
        ? localRecords.value.recurringItems.map((existing) =>
            existing.id === saved.id ? saved : existing,
          )
        : [...localRecords.value.recurringItems, saved],
    }
    return saved
  }

  function removeRecurringItem(itemId: string): void {
    localRecords.value = {
      ...localRecords.value,
      recurringItems: localRecords.value.recurringItems.filter((item) => item.id !== itemId),
    }
  }

  function addTransfer(transfer: Omit<Transfer, 'id' | 'createdAt'>): Transfer {
    const saved: Transfer = {
      ...transfer,
      id: createId('xfer'),
      // Epoch milliseconds, which is what `transfers.created_at` maps to (see
      // the mapping table in docs/database/schema.md). Reading the clock is
      // fine here and only here — the domain never does it.
      createdAt: Date.now(),
    }
    localRecords.value = {
      ...localRecords.value,
      transfers: [...localRecords.value.transfers, saved],
    }
    return saved
  }

  function setSafetyCushion(cushion: MinorUnits): void {
    settingsOverride.value = {
      ...settingsOverride.value,
      safetyCushion: Math.max(0, Math.round(cushion)),
    }
  }

  /** Pass `null` to go back to following the device. */
  function setTimeZoneOverride(timeZone: string | null): void {
    settingsOverride.value = {
      ...settingsOverride.value,
      timeZone: timeZone?.trim() || null,
    }
  }

  function setMonthlyDiscretionarySpend(amount: MinorUnits): void {
    settingsOverride.value = {
      ...settingsOverride.value,
      monthlyDiscretionarySpend: Math.max(0, Math.round(amount)),
    }
  }

  /**
   * Drops the session-local records, leaving accounts and settings alone.
   *
   * Onboarding needs a blank slate to build its recurring-item step onto —
   * with a leftover item present, the first-run flow would be adding a
   * second one, not a first. **This must never touch database accounts**:
   * they are the user's real data now, not seeded state to reset.
   */
  function clearRecords(): void {
    localRecords.value = { recurringItems: [], transfers: [] }
  }

  /** True when the user has nothing to project from — the "skipped onboarding" case. */
  const isEmpty = computed(() => accounts.value.length === 0)

  return {
    data,
    accounts,
    archived,
    accountsById,
    staleAfterDays,
    isLoading,
    loadError,
    refresh: async () => {
      await refresh()
    },
    recurringItems,
    transfers,
    safetyCushion,
    timeZoneOverride,
    isEmpty,
    accountName,
    saveAccount,
    saveBalances,
    archiveAccount,
    restoreAccount,
    saveRecurringItem,
    removeRecurringItem,
    addTransfer,
    setSafetyCushion,
    setTimeZoneOverride,
    setMonthlyDiscretionarySpend,
    clearRecords,
  }
}
