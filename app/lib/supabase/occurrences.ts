/**
 * The mapping layer for `public.occurrences` — issue #9's write path
 * (`regenerate_occurrences`) and issue #15's read/write paths
 * (`override_occurrence`, `revert_occurrence`, `split_recurring_rule`,
 * `supabase/migrations/20260913090000_occurrence_overrides_and_rule_split.sql`).
 *
 * Pure, no Nuxt imports, so `bun run test:unit` can cover it directly —
 * mirrors `app/lib/supabase/recurring-items.ts`'s shape. No longer
 * write-only: `toOccurrenceOverride` is what turns the overlay read in
 * `useRunwayData.ts` into `RunwayData.occurrenceOverrides`.
 * `tests/guards/occurrence-write-sites.test.ts` enforces that
 * `useRunwayData.ts` is the only caller of all four RPCs, and that the one
 * read this file's mapper feeds is a `.select(`, never an `.update(`/`.delete(`.
 */

import type { Database } from '#shared/supabase/database.types'
import type { IsoDate } from '~~/domain/dates'
import type { DesiredOccurrence, MaterializationWindow } from '~~/domain/materialization'
import type { MinorUnits } from '~~/domain/money'
import type { StoredOccurrenceOverride } from '~~/domain/overrides'

export type OccurrenceRow = Database['public']['Tables']['occurrences']['Row']

export type RegenerationArgs = Database['public']['Functions']['regenerate_occurrences']['Args']

/**
 * Builds the RPC's parallel-array payload from a desired set.
 *
 * `ruleIds` is de-duplicated so a caller passing the same id twice (or the
 * whole household's rule list, which is already distinct) never sends a
 * duplicate array entry. `desired` is unzipped in one pass so the three
 * parallel arrays cannot drift out of index alignment — the RPC's own length
 * check (`supabase/migrations/20260904015555_occurrence_regeneration.sql`)
 * is the second line of defense, not the first.
 *
 * Performs no arithmetic on amounts — it copies `DesiredOccurrence.amount`
 * straight through, already signed by `domain/materialization.ts`.
 */
export function toRegenerationArgs(
  ruleIds: readonly string[],
  window: MaterializationWindow,
  desired: readonly DesiredOccurrence[],
): RegenerationArgs {
  const p_occurrence_rule_ids: string[] = []
  const p_occurrence_dates: string[] = []
  const p_occurrence_amount_cents: number[] = []

  for (const occurrence of desired) {
    p_occurrence_rule_ids.push(occurrence.ruleId)
    p_occurrence_dates.push(occurrence.date)
    p_occurrence_amount_cents.push(occurrence.amount)
  }

  return {
    p_rule_ids: [...new Set(ruleIds)],
    p_window_start: window.start,
    p_window_end: window.end,
    p_occurrence_rule_ids,
    p_occurrence_dates,
    p_occurrence_amount_cents,
  }
}

/** Named columns for the overlay read — never `select('*')`. */
export const OVERRIDE_COLUMNS =
  'rule_id, projected_date, projected_amount_cents, actual_date, actual_amount_cents, status, is_overridden' as const

/**
 * What a `.select(OVERRIDE_COLUMNS)` query actually returns — narrowed to the
 * named columns, not the whole `Row` type, so `toOccurrenceOverride`'s
 * parameter and the column list can never drift apart silently.
 */
export type SelectedOccurrenceRow = Pick<
  OccurrenceRow,
  | 'rule_id'
  | 'projected_date'
  | 'projected_amount_cents'
  | 'actual_date'
  | 'actual_amount_cents'
  | 'status'
  | 'is_overridden'
>

/**
 * Maps one overridden, still-`projected` row to a `StoredOccurrenceOverride`.
 * `useRunwayData.ts`'s overlay query already filters to
 * `is_overridden = true and status = 'projected'`, so every row this sees is
 * eligible — a `confirmed`/`skipped` row never reaches here.
 *
 * `itemId` is `rule_id`: `RecurringItem.id` is the rule's own uuid
 * (`app/lib/supabase/recurring-items.ts` `toRecurringItem`), so no separate
 * lookup is needed to go from a row to the item it overrides.
 */
export function toOccurrenceOverride(row: SelectedOccurrenceRow): StoredOccurrenceOverride {
  return {
    itemId: row.rule_id,
    date: row.projected_date,
    scope: 'once',
    // Both already signed, matching `Occurrence.amount` — no arithmetic, no
    // `Number()` coercion. `actual_amount_cents` is set on every overridden
    // row (`override_occurrence` always writes it), but `??` is the honest
    // fallback for a row this file did not itself create.
    amount: row.actual_amount_cents ?? row.projected_amount_cents,
    // `null` maps to *absent* — `exactOptionalPropertyTypes` requires it, the
    // same idiom `app/lib/supabase/accounts.ts` `toAccount` uses for `archivedOn`.
    ...(row.actual_date ? { newDate: row.actual_date } : {}),
  }
}

export type OverrideArgs = Database['public']['Functions']['override_occurrence']['Args']
export type RevertArgs = Database['public']['Functions']['revert_occurrence']['Args']
export type SplitArgs = Database['public']['Functions']['split_recurring_rule']['Args']

/**
 * Builds `override_occurrence`'s RPC payload. `edit.date` is the occurrence's
 * `projectedDate` — half of `occurrences`' natural key — never the
 * post-override `date`; using the latter would re-key the write onto a moved
 * day. `edit.amount` is the new `actual_amount_cents`; `edit.projectedAmount`
 * is the rule's own value, carried along for the insert branch (a first
 * override of a not-yet-materialized date).
 */
export function toOverrideArgs(edit: {
  readonly itemId: string
  readonly date: IsoDate
  readonly amount: MinorUnits
  readonly projectedAmount: MinorUnits
  readonly newDate?: IsoDate
}): OverrideArgs {
  return {
    p_rule_id: edit.itemId,
    p_projected_date: edit.date,
    p_projected_amount_cents: edit.projectedAmount,
    p_actual_amount_cents: edit.amount,
    // The generated Args type marks this non-null because the generator has
    // no way to see that the SQL function accepts NULL for "on
    // projected_date" — the same gap `saveAccount`'s `p_id` cast documents.
    p_actual_date: (edit.newDate ?? null) as unknown as IsoDate,
  }
}

export function toRevertArgs(itemId: string, date: IsoDate): RevertArgs {
  return { p_rule_id: itemId, p_projected_date: date }
}

/** `amount` is a positive magnitude, matching `recurring_rules.amount_cents`. */
export function toSplitArgs(args: {
  readonly itemId: string
  readonly effectiveFrom: IsoDate
  readonly amount: MinorUnits
}): SplitArgs {
  return {
    p_rule_id: args.itemId,
    p_effective_from: args.effectiveFrom,
    p_amount_cents: args.amount,
  }
}
