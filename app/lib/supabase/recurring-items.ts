/**
 * The row↔domain mapping for `recurring_rules`.
 *
 * Pure, no Nuxt imports, so `bun run test:unit` can cover it directly. Types
 * come from the generated `Database`, so a schema drift is a compile error
 * here rather than a runtime surprise in `useRunwayData`. Mirrors
 * `app/lib/supabase/accounts.ts` — same shape, same reasoning.
 */

import type { Database } from '#shared/supabase/database.types'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { AmountSource, Cadence, RecurringItem, RecurringKind } from '~~/domain/types'

export type RecurringRuleRow = Database['public']['Tables']['recurring_rules']['Row']

/** Named columns, never `select('*')` — a column added later is a deliberate addition. */
export const RECURRING_RULE_COLUMNS =
  'id, account_id, name, kind, amount_cents, amount_source, is_variable, cadence, anchor_date, days_of_month, days_of_week, starts_on, ends_on' as const

/**
 * What a `.select(RECURRING_RULE_COLUMNS)` query actually returns — the full
 * row narrowed to the named columns, not the whole `Row` type. `toRecurringItem`
 * takes exactly this, so the parameter type and the column list can never
 * drift apart silently.
 */
export type SelectedRecurringRuleRow = Pick<
  RecurringRuleRow,
  | 'id'
  | 'account_id'
  | 'name'
  | 'kind'
  | 'amount_cents'
  | 'amount_source'
  | 'is_variable'
  | 'cadence'
  | 'anchor_date'
  | 'days_of_month'
  | 'days_of_week'
  | 'starts_on'
  | 'ends_on'
>

/** The `saveRecurringItem` parameter — `RecurringItem` minus its database-assigned `id`. */
export interface RecurringItemDraft extends Omit<RecurringItem, 'id'> {
  readonly id?: string
}

/**
 * `depositHistory` is always read as `[]` — it is *derived*
 * (`occurrences.actual_amount_cents where status = 'confirmed'`, per
 * `docs/database/schema.md`), not a column on this row. Occurrence
 * materialization is out of scope for issue #8, so the app cannot populate it
 * yet; this is honest about that rather than inventing a column.
 */
export function toRecurringItem(row: SelectedRecurringRuleRow): RecurringItem {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    // PostgREST returns bigint columns as a JSON number; it is already
    // integer cents and stays one — no `Number()` coercion, no arithmetic.
    amount: row.amount_cents,
    cadence: row.cadence,
    accountId: row.account_id,
    // Names differ deliberately — see docs/database/schema.md's mapping
    // table. `anchor_date` is the cadence's phase, not "the next date".
    nextOccurrence: row.anchor_date,
    amountSource: row.amount_source,
    depositHistory: [],
    isVariable: row.is_variable,
    // `null` maps to *absent*, not to `daysOfMonth: undefined` —
    // `exactOptionalPropertyTypes` requires it, and `toAccount` uses the same
    // idiom for `archivedOn`.
    ...(row.days_of_month ? { daysOfMonth: row.days_of_month } : {}),
    ...(row.days_of_week ? { daysOfWeek: row.days_of_week } : {}),
    ...(row.starts_on ? { startsOn: row.starts_on } : {}),
    ...(row.ends_on ? { endsOn: row.ends_on } : {}),
  }
}

/** Column values for an insert or update. `user_id` is added by the caller, from the session. */
export function toRecurringRuleColumns(draft: RecurringItemDraft): {
  account_id: string
  name: string
  kind: RecurringKind
  amount_cents: MinorUnits
  amount_source: AmountSource
  is_variable: boolean
  cadence: Cadence
  anchor_date: IsoDate
  days_of_month: number[] | null
  days_of_week: number[] | null
  starts_on: IsoDate | null
  ends_on: IsoDate | null
} {
  return {
    account_id: draft.accountId,
    name: draft.name,
    kind: draft.kind,
    amount_cents: draft.amount,
    amount_source: draft.amountSource,
    is_variable: draft.isVariable,
    cadence: draft.cadence,
    anchor_date: draft.nextOccurrence,
    // Optional-in-the-domain, nullable-in-the-database — both mean "the day
    // anchor_date names". `undefined` is not a valid column value, so this is
    // the absent-to-null half of the idiom above.
    days_of_month: draft.daysOfMonth ? [...draft.daysOfMonth] : null,
    days_of_week: draft.daysOfWeek ? [...draft.daysOfWeek] : null,
    starts_on: draft.startsOn ?? null,
    ends_on: draft.endsOn ?? null,
  }
}
