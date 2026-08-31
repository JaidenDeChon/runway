/**
 * The row↔domain mapping for `accounts` and `user_settings`.
 *
 * Pure, no Nuxt imports, so `bun run test:unit` can cover it directly. Types
 * come from the generated `Database`, so a schema drift is a compile error
 * here rather than a runtime surprise in `useRunwayData`.
 */

import type { Database } from '#shared/supabase/database.types'
import { DEFAULT_STALE_AFTER_DAYS } from '~~/domain/accounts'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { Account, AccountColor } from '~~/domain/types'
import { ACCOUNT_COLORS } from '~~/domain/types'

export type AccountRow = Database['public']['Tables']['accounts']['Row']
export type UserSettingsRow = Database['public']['Tables']['user_settings']['Row']

/** Named columns, never `select('*')` — a column added later is a deliberate addition. */
export const ACCOUNT_COLUMNS = 'id, name, color, balance_cents, balance_as_of, archived_on' as const
export const USER_SETTINGS_COLUMNS =
  'user_id, cushion_cents, monthly_discretionary_cents, discretionary_account_id, default_horizon_days, time_zone, balance_stale_after_days' as const

/**
 * What a `.select(ACCOUNT_COLUMNS)` / `.select(USER_SETTINGS_COLUMNS)` query
 * actually returns — the full row narrowed to the named columns, not the
 * whole `Row` type. `toAccount` and `toHouseholdSettings` take exactly this,
 * so the parameter type and the column list can never drift apart silently.
 */
export type SelectedAccountRow = Pick<
  AccountRow,
  'id' | 'name' | 'color' | 'balance_cents' | 'balance_as_of' | 'archived_on'
>
export type SelectedUserSettingsRow = Pick<
  UserSettingsRow,
  | 'user_id'
  | 'cushion_cents'
  | 'monthly_discretionary_cents'
  | 'discretionary_account_id'
  | 'default_horizon_days'
  | 'time_zone'
  | 'balance_stale_after_days'
>

/** The `saveAccount` parameter. Omits `archivedOn` — the editor never sets it. */
export interface AccountDraft {
  readonly id?: string
  readonly name: string
  readonly balance: MinorUnits
  readonly balanceAsOf: IsoDate
  readonly color: AccountColor
  readonly isDiscretionarySource: boolean
}

export interface HouseholdSettings {
  readonly safetyCushion: MinorUnits
  readonly monthlyDiscretionarySpend: MinorUnits
  readonly timeZone: string | null
  readonly staleAfterDays: number
  readonly discretionaryAccountId: string | null
}

/**
 * `color` is `text` in the database, restricted by a check constraint the
 * client cannot see. A row that fails the narrowing cannot come from this
 * app, but it could come from a hand-edited row or a future migration this
 * mapping has not caught up with — falling back rather than casting blindly
 * means a bad value renders an account instead of throwing one out of a list.
 */
function toAccountColor(color: string): AccountColor {
  return (ACCOUNT_COLORS as readonly string[]).includes(color) ? (color as AccountColor) : 'chart-2'
}

/** `isDiscretionarySource` is derived — the flag is one column on `user_settings`, not on the row. */
export function toAccount(row: SelectedAccountRow, discretionaryAccountId: string | null): Account {
  return {
    id: row.id,
    name: row.name,
    // PostgREST returns bigint columns as a JSON number; it is already integer
    // cents and stays one — no `Number()` coercion of a float, no arithmetic.
    balance: row.balance_cents,
    balanceAsOf: row.balance_as_of,
    color: toAccountColor(row.color),
    isDiscretionarySource: row.id === discretionaryAccountId,
    // `null` maps to *absent*, not to `archivedOn: undefined` — the same
    // idiom `tests/rls/seed-fidelity.test.ts` uses for `startsOn`, and the one
    // `exactOptionalPropertyTypes` requires: assigning `undefined` to an
    // optional field it did not declare `| undefined` is a type error.
    ...(row.archived_on ? { archivedOn: row.archived_on } : {}),
  }
}

/** Column values for an insert or update. `user_id` is added by the caller, from the session. */
export function toAccountColumns(draft: AccountDraft): {
  name: string
  color: AccountColor
  balance_cents: MinorUnits
  balance_as_of: IsoDate
} {
  return {
    name: draft.name,
    color: draft.color,
    balance_cents: draft.balance,
    balance_as_of: draft.balanceAsOf,
  }
}

/** A missing settings row (an account created before the signup trigger) falls back to the column defaults. */
export function toHouseholdSettings(row: SelectedUserSettingsRow | null): HouseholdSettings {
  if (!row) {
    return {
      safetyCushion: 60_000,
      monthlyDiscretionarySpend: 0,
      timeZone: null,
      staleAfterDays: DEFAULT_STALE_AFTER_DAYS,
      discretionaryAccountId: null,
    }
  }
  return {
    safetyCushion: row.cushion_cents,
    monthlyDiscretionarySpend: row.monthly_discretionary_cents,
    timeZone: row.time_zone,
    staleAfterDays: row.balance_stale_after_days,
    discretionaryAccountId: row.discretionary_account_id,
  }
}
