/**
 * The app's single copy of the user's financial data.
 *
 * **Accounts, settings, recurring items and the dashboard's two preferences
 * are Supabase-backed; transfers are not yet.** Issue #7 moved the accounts
 * screen onto real rows, issue #8 moved recurring items the same way, and
 * issue #12 moved the dashboard's horizon and hidden-account selection off
 * `useState` and onto `user_settings.default_horizon_days` and
 * `public.dashboard_hidden_accounts` — `RunwayData.accounts`,
 * `RunwayData.recurringItems` and the settings that ride along with accounts
 * (`safetyCushion`, `monthlyDiscretionarySpend`, `timeZone`,
 * `staleAfterDays`) come from `public.accounts`, `public.recurring_rules` and
 * `public.user_settings` under the signed-in user's own session. Transfers
 * stay session-local `useState` — issue #9 owns moving those — and start
 * **empty** rather than from `domain/seed.ts`: a seeded transfer carries
 * account ids like `'acct-checking'`, which dangle against the account uuids
 * the database actually holds, and the projection would silently move money
 * between accounts that do not exist.
 *
 * The dashboard's two preferences ride on the same `useAsyncData` as
 * everything else, which runs on the server and transfers its payload to the
 * client — unlike `useChartDensity`, there is no post-mount restore here and
 * therefore no hydration mismatch to design around: the first server render
 * already reads the stored horizon and hidden set.
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
  HIDDEN_ACCOUNT_COLUMNS,
  toAccount,
  toAccountColumns,
  toHiddenAccountIds,
  toHouseholdSettings,
  USER_SETTINGS_COLUMNS,
} from '@/lib/supabase/accounts'
import {
  RECURRING_RULE_COLUMNS,
  type RecurringItemDraft,
  toRecurringItem,
  toRecurringRuleColumns,
} from '@/lib/supabase/recurring-items'
import type { BalanceReading } from '~~/domain/accounts'
import { activeAccounts, archivedAccounts } from '~~/domain/accounts'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import { resolveAmount } from '~~/domain/prediction'
import type { Account, RecurringItem, RunwayData, Transfer } from '~~/domain/types'

export type { AccountDraft, RecurringItemDraft }

interface RemoteHousehold {
  readonly accounts: readonly Account[]
  readonly recurringItems: readonly RecurringItem[]
  readonly settings: HouseholdSettings
  /** Ids of the accounts hidden from the dashboard's chart legend. */
  readonly hiddenAccountIds: readonly string[]
}

/** What an anonymous visitor, or a request with no session, sees. */
const EMPTY_HOUSEHOLD: RemoteHousehold = {
  accounts: [],
  recurringItems: [],
  settings: toHouseholdSettings(null),
  hiddenAccountIds: [],
}

interface LocalRecords {
  /** Whose session these records belong to, so a user switch can be detected. */
  readonly ownerId: string | null
  readonly transfers: readonly Transfer[]
}

/**
 * Ids are generated here rather than in the domain because they are a storage
 * concern — a real backend would assign them. Still used for transfers;
 * accounts and recurring items now get their id from the database's own
 * default, the same way accounts have since issue #7.
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
      const [accountsResult, recurringRulesResult, settingsResult, hiddenAccountsResult] =
        await Promise.all([
          client
            .from('accounts')
            .select(ACCOUNT_COLUMNS)
            // The seeded Checking/Savings rows share a created_at; id breaks the
            // tie in the order the design draws them.
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }),
          client
            .from('recurring_rules')
            .select(RECURRING_RULE_COLUMNS)
            // `anchor_date` is a phase, not a "next date" (see
            // app/lib/supabase/recurring-items.ts), so this is not the list's
            // display order — the page computes and sorts on the true next
            // occurrence itself. It just needs to be deterministic; id breaks
            // the tie the same way the accounts query does.
            .order('anchor_date', { ascending: true })
            .order('id', { ascending: true }),
          client.from('user_settings').select(USER_SETTINGS_COLUMNS).maybeSingle(),
          client.from('dashboard_hidden_accounts').select(HIDDEN_ACCOUNT_COLUMNS),
        ])
      // The database's own error message can name columns, constraints and
      // policies. It goes nowhere near the UI, and nothing but the code is
      // logged — see CLAUDE.md on what must never reach a log.
      if (accountsResult.error) {
        console.error('accounts read failed', { code: accountsResult.error.code })
        throw new Error('load-failed')
      }
      if (recurringRulesResult.error) {
        console.error('recurring rules read failed', { code: recurringRulesResult.error.code })
        throw new Error('load-failed')
      }
      if (settingsResult.error) {
        console.error('settings read failed', { code: settingsResult.error.code })
        throw new Error('load-failed')
      }
      if (hiddenAccountsResult.error) {
        console.error('hidden chart accounts read failed', {
          code: hiddenAccountsResult.error.code,
        })
        throw new Error('load-failed')
      }
      const settings = toHouseholdSettings(settingsResult.data)
      return {
        hiddenAccountIds: toHiddenAccountIds(hiddenAccountsResult.data),
        accounts: (accountsResult.data ?? []).map((row) =>
          toAccount(row, settings.discretionaryAccountId),
        ),
        recurringItems: (recurringRulesResult.data ?? []).map(toRecurringItem),
        settings,
      }
    },
    { default: () => EMPTY_HOUSEHOLD, watch: [authUser] },
  )

  // Transfers are still held in memory and lost on reload — issue #9 owns
  // moving them onto Supabase. See the file comment for why they start empty
  // rather than from `domain/seed.ts`.
  const localRecords = useState<LocalRecords>('runway-local-records', () => ({
    ownerId: authUser.value?.id ?? null,
    transfers: [],
  }))

  // Session-local records belong to whoever was signed in when they were
  // created. Sign-out and sign-in are both client-side navigations — no full
  // page reload — so unlike the household `useAsyncData` above (which
  // re-fetches on `watch: [authUser]`), nothing was re-deriving these from
  // the new session: as user A, add a transfer; sign out; sign in as a
  // different user D; A's transfer was still on screen.
  //
  // Keyed on the user's *id* changing, not on reference equality to
  // `authUser` itself: `authUsersEqual()` (app/plugins/supabase.client.ts)
  // already keeps `authUser`'s reference stable across an unchanged user, so
  // watching the id here means signing out and back in as the SAME user does
  // not needlessly discard their in-progress, unsaved transfers — only an
  // actual change of person clears them. Recurring items needed this same
  // watch once, before issue #8 moved them onto the `useAsyncData` above —
  // that fetch re-runs on the same `watch: [authUser]` transition, so the
  // leak this watch exists to close is already closed for them by construction.
  // Settings this screen reads but has no UI to write yet:
  // `cushion_cents`, `monthly_discretionary_cents` and `time_zone` ride along
  // on the one `user_settings` query the discretionary designation already
  // requires — a plain read, always. Their setters below write into this
  // session-local overlay instead of the database, exactly the stance
  // `docs/database/schema.md` already records for `time_zone`: the writer
  // waits for the settings screen. No screen calls those setters today.
  const settingsOverride = useState<Partial<HouseholdSettings>>(
    'runway-settings-override',
    () => ({}),
  )

  // The dashboard's hidden-account selection, held the same way while a write
  // is in flight: `setAccountHidden` below sets this optimistically before the
  // database confirms it, so the checkbox responds instantly rather than
  // waiting on a round trip. `null` means "no optimistic value — read the
  // stored set", not "hide nothing"; an empty array is a real, deliberate
  // value once the user has un-hidden everything.
  const hiddenOverride = useState<string[] | null>('runway-hidden-accounts-override', () => null)

  // Session-local records, and both preference overlays, belong to whoever was
  // signed in when they were created. Sign-out and sign-in are both
  // client-side navigations — no full page reload — so unlike the household
  // `useAsyncData` above (which re-fetches on `watch: [authUser]`), nothing
  // was re-deriving these from the new session: as user A, add a transfer or
  // hide an account; sign out; sign in as a different user D; A's transfer and
  // A's hidden account were still on screen. Issue #12 is what makes the
  // overlay reset below load-bearing rather than defensive: `settingsOverride`
  // has existed since #7 with no live writer, so this leak was latent; the
  // dashboard's setters are its first.
  //
  // Keyed on the user's *id* changing, not on reference equality to
  // `authUser` itself: `authUsersEqual()` (app/plugins/supabase.client.ts)
  // already keeps `authUser`'s reference stable across an unchanged user, so
  // watching the id here means signing out and back in as the SAME user does
  // not needlessly discard their in-progress, unsaved transfers — only an
  // actual change of person clears them. Recurring items needed this same
  // watch once, before issue #8 moved them onto the `useAsyncData` above —
  // that fetch re-runs on the same `watch: [authUser]` transition, so the
  // leak this watch exists to close is already closed for them by construction.
  watch(
    () => authUser.value?.id ?? null,
    (nextOwnerId) => {
      if (localRecords.value.ownerId === nextOwnerId) return
      localRecords.value = { ownerId: nextOwnerId, transfers: [] }
      settingsOverride.value = {}
      hiddenOverride.value = null
    },
  )

  const accountsById = computed(
    () => new Map(remote.value.accounts.map((account) => [account.id, account])),
  )

  /** Active accounts, in creation order. */
  const accounts = computed(() => activeAccounts(remote.value.accounts))
  /** Archived accounts, most recently archived first. */
  const archived = computed(() => archivedAccounts(remote.value.accounts))

  const recurringItems = computed(() => remote.value.recurringItems)
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

  /**
   * The dashboard's stored horizon. Not a field on `RunwayData` — the
   * projection engine takes its window as a parameter and does not know a
   * "default" exists; see `docs/database/schema.md` § "The horizon is not a
   * menu". A value outside the toggle's 30/60/90 (unreachable through the UI
   * today, but the column allows 1–730) is returned verbatim rather than
   * snapped to the nearest option.
   */
  const defaultHorizonDays = computed(
    () => settingsOverride.value.defaultHorizonDays ?? remote.value.settings.defaultHorizonDays,
  )

  /**
   * Ids of the accounts hidden from the dashboard's chart legend. The stored
   * set is the hidden one, never the shown one — see the migration comment on
   * `dashboard_hidden_accounts` — so an account with no row here is visible by
   * default.
   */
  const hiddenAccountIds = computed<readonly string[]>(
    () => hiddenOverride.value ?? remote.value.hiddenAccountIds,
  )

  const isLoading = computed(() => pending.value)
  /**
   * Fixed copy, never a database message — see the read failure above.
   * Generic on purpose: this one fetch now backs both the accounts screen and
   * the recurring-items screen, and a failure could be any of the three reads
   * it makes.
   */
  const loadError = computed(() => (error.value ? 'Could not load your data.' : null))

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
   * Inserts or updates an account and re-establishes the one-source
   * discretionary invariant through `save_account`
   * (`supabase/migrations/20260831011511_accounts_atomic_writes.sql`), a
   * single RPC rather than two separate requests.
   *
   * That migration exists because two requests could partially fail: the
   * account insert committed while the follow-up `user_settings` update
   * threw, so the local `id` was lost, `props.account` in `AccountEditor`
   * stayed `null`, and pressing the button again inserted a *second* row. The
   * function body is one transaction, so both writes land or neither does.
   *
   * No optimistic update: a refresh is cheaper than a client-side guess that
   * can disagree with the database, and every mutation here takes the same
   * stance.
   */
  async function saveAccount(draft: AccountDraft): Promise<Account> {
    requireUserId()
    const columns = toAccountColumns(draft)

    const { data: saved, error: saveError } = await client.rpc('save_account', {
      // The generated Args type marks every parameter non-null, because the
      // type generator has no way to see that `p_id uuid` (unlike the other
      // params) accepts SQL NULL — which is exactly what the function's
      // insert branch expects for a brand-new account.
      p_id: (draft.id ?? null) as unknown as string,
      p_name: columns.name,
      p_color: columns.color,
      p_balance_cents: columns.balance_cents,
      p_balance_as_of: columns.balance_as_of,
      p_is_discretionary_source: draft.isDiscretionarySource,
    })
    if (saveError || !saved) {
      console.error('account save failed', { code: saveError?.code })
      throw new Error('save-failed')
    }

    await refresh()
    const result = remote.value.accounts.find((account) => account.id === saved.id)
    if (!result) throw new Error('save-failed')
    return result
  }

  /**
   * Records balances observed on `asOf` for every reading, through
   * `save_account_balances`
   * (`supabase/migrations/20260831011511_accounts_atomic_writes.sql`) — one
   * RPC, one transaction, rather than one request per account in
   * `Promise.all`.
   *
   * That migration exists because the old per-account requests were not
   * atomic across accounts: a failure partway through left some accounts
   * updated and others not, and the dashboard went on projecting from
   * balances the database no longer agreed with — worse than `saveAccount`'s
   * bug, because nothing here was retryable without re-typing the accounts
   * that *did* save.
   *
   * Readings naming an unknown or archived account are dropped before the
   * call, mirroring `domain/accounts.ts` `applyBalanceReadings`.
   */
  async function saveBalances(readings: readonly BalanceReading[], asOf: IsoDate): Promise<void> {
    requireUserId()
    const activeIds = new Set(accounts.value.map((account) => account.id))
    const applicable = readings.filter((reading) => activeIds.has(reading.accountId))

    const { error: saveError } = await client.rpc('save_account_balances', {
      p_account_ids: applicable.map((reading) => reading.accountId),
      p_balance_cents: applicable.map((reading) => reading.balance),
      p_as_of: asOf,
    })
    if (saveError) {
      console.error('balance update failed', { code: saveError.code })
      throw new Error('save-failed')
    }
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

  /**
   * Inserts or updates a recurring rule. One write to one table — unlike
   * `saveAccount`, this needs no RPC, because there is no second table that
   * could partially fail alongside it.
   *
   * No optimistic update, matching every other mutation here: a refresh is
   * cheaper than a client-side guess that can disagree with the database.
   */
  async function saveRecurringItem(draft: RecurringItemDraft): Promise<RecurringItem> {
    const userId = requireUserId()
    // Prediction is resolved at save time, not at render time, so the row and
    // the projection always read one stored figure. `resolveAmount` reads
    // `depositHistory` and `id`; a brand-new draft has neither yet, and an
    // unresolved id doesn't change what a fixed or already-predicted amount
    // resolves to.
    const amount = resolveAmount({ ...draft, id: draft.id ?? '' })
    const columns = toRecurringRuleColumns({ ...draft, amount })

    const { data: saved, error: saveError } = draft.id
      ? await client
          .from('recurring_rules')
          .update(columns)
          .eq('id', draft.id)
          .eq('user_id', userId)
          .select(RECURRING_RULE_COLUMNS)
          .single()
      : await client
          .from('recurring_rules')
          .insert({ ...columns, user_id: userId })
          .select(RECURRING_RULE_COLUMNS)
          .single()
    if (saveError || !saved) {
      console.error('recurring item save failed', { code: saveError?.code })
      throw new Error('save-failed')
    }

    await refresh()
    const result = remote.value.recurringItems.find((item) => item.id === saved.id)
    if (!result) throw new Error('save-failed')
    return result
  }

  async function removeRecurringItem(itemId: string): Promise<void> {
    const userId = requireUserId()
    const { error: deleteError } = await client
      .from('recurring_rules')
      .delete()
      .eq('id', itemId)
      .eq('user_id', userId)
    if (deleteError) {
      console.error('recurring item delete failed', { code: deleteError.code })
      throw new Error('save-failed')
    }
    await refresh()
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
   * Persists the dashboard's horizon. Values outside `1..730` are ignored —
   * the column's own check constraint, and the toggle itself never offers one
   * anyway.
   *
   * Writes the overlay optimistically so the control responds the moment it
   * is clicked, then persists with `upsert`, not `update`: a plain `update`
   * would silently affect zero rows for a user whose settings row is missing
   * — exactly the case `toHouseholdSettings(null)` exists for. Never throws
   * — the design has no error copy for a failed preference write, and the
   * projection is correct either way; a reverted control is the feedback.
   * Does not call `refresh()`: a preference write must not re-run all four
   * queries and re-render the chart underneath the user.
   */
  async function setDefaultHorizonDays(days: number): Promise<void> {
    if (!Number.isInteger(days) || days < 1 || days > 730) return
    const userId = authUser.value?.id
    if (!userId) return
    const previous = settingsOverride.value
    settingsOverride.value = { ...settingsOverride.value, defaultHorizonDays: days }
    const { error: writeError } = await client
      .from('user_settings')
      .upsert({ user_id: userId, default_horizon_days: days }, { onConflict: 'user_id' })
    if (writeError) {
      console.error('default horizon write failed', { code: writeError.code })
      settingsOverride.value = previous
    }
  }

  /**
   * Hides or shows an account's series on the dashboard chart.
   *
   * Presence in `dashboard_hidden_accounts` *is* the value — there is no
   * column to update — so hiding inserts a row and showing deletes one.
   * Optimistic and non-throwing, for the same reasons `setDefaultHorizonDays`
   * is: the checkbox reflects the change instantly, a failure reverts it and
   * logs the error code only, and no `refresh()` follows a successful write.
   */
  async function setAccountHidden(accountId: string, hidden: boolean): Promise<void> {
    const userId = authUser.value?.id
    if (!userId) return
    const previous = hiddenOverride.value ?? remote.value.hiddenAccountIds
    const next = hidden
      ? previous.includes(accountId)
        ? previous
        : [...previous, accountId]
      : previous.filter((id) => id !== accountId)
    hiddenOverride.value = [...next]
    const { error: writeError } = hidden
      ? await client
          .from('dashboard_hidden_accounts')
          .insert({ user_id: userId, account_id: accountId })
      : await client
          .from('dashboard_hidden_accounts')
          .delete()
          .eq('user_id', userId)
          .eq('account_id', accountId)
    if (writeError) {
      console.error('dashboard account visibility write failed', { code: writeError.code })
      hiddenOverride.value = [...previous]
    }
  }

  /**
   * Drops the session-local transfers, leaving accounts, settings and
   * recurring items alone.
   *
   * Onboarding used to call this to give its recurring-item step a blank
   * slate; now that items are real rows, a returning user's items are real
   * data and this cannot clear them without deleting them — which a session
   * reset must never do. `first-run.vue`'s own `itemId` ref already makes its
   * recurring-item step idempotent (a repeat "Continue" upserts the same row
   * instead of creating a second one), so onboarding does not need this for
   * that purpose any more. Kept for transfers, which are still session-local.
   */
  function clearRecords(): void {
    localRecords.value = { ownerId: localRecords.value.ownerId, transfers: [] }
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
    defaultHorizonDays,
    hiddenAccountIds,
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
    setDefaultHorizonDays,
    setAccountHidden,
    clearRecords,
  }
}
