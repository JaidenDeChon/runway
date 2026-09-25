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
 * Issue #18 adds `withSettledHistory`, which turns
 * `recent_settled_amounts()` into each rule's `depositHistory` — a read-only
 * RPC, held to the same one-call-site rule by that guard. Issue #26's manual
 * half adds `settle_occurrence` / `unsettle_occurrence`
 * (`supabase/migrations/20260925010000_settle_occurrence.sql`), and the
 * overlay read now carries settled rows too.
 */

import type { Database } from '#shared/supabase/database.types'
import type { IsoDate } from '~~/domain/dates'
import { compareDates } from '~~/domain/dates'
import type { DesiredOccurrence, MaterializationWindow } from '~~/domain/materialization'
import type { MinorUnits } from '~~/domain/money'
import type { StoredOccurrenceOverride } from '~~/domain/overrides'
import { recentHistory, settledMagnitude } from '~~/domain/prediction'
import type { RecurringItem } from '~~/domain/types'

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
 * Maps one overlay row to a `StoredOccurrenceOverride`: an overridden,
 * still-`projected` row (issue #15), or a settled — `confirmed` — one (issue
 * #26's manual half), which becomes an override with `settled: true`.
 * `useRunwayData.ts`'s overlay query filters to exactly those two; a
 * `skipped` row never reaches here.
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
    ...(row.status === 'confirmed' ? { settled: true } : {}),
  }
}

export type OverrideArgs = Database['public']['Functions']['override_occurrence']['Args']
export type RevertArgs = Database['public']['Functions']['revert_occurrence']['Args']
export type SplitArgs = Database['public']['Functions']['split_recurring_rule']['Args']
export type SettleArgs = Database['public']['Functions']['settle_occurrence']['Args']
export type UnsettleArgs = Database['public']['Functions']['unsettle_occurrence']['Args']

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

/**
 * Builds `settle_occurrence`'s payload (issue #26, manual half). Keyed like
 * `toOverrideArgs` — `settlement.date` is the occurrence's `projectedDate`,
 * never the day it actually landed — but `actualDate` is always sent: a
 * settlement records *when* it happened, where an override's `null` means
 * "on the projected day". `amount` is signed, matching `Occurrence.amount`;
 * the function refuses a sign that contradicts the rule's kind.
 */
export function toSettleArgs(settlement: {
  readonly itemId: string
  readonly date: IsoDate
  readonly amount: MinorUnits
  readonly projectedAmount: MinorUnits
  readonly actualDate: IsoDate
}): SettleArgs {
  return {
    p_rule_id: settlement.itemId,
    p_projected_date: settlement.date,
    p_projected_amount_cents: settlement.projectedAmount,
    p_actual_amount_cents: settlement.amount,
    p_actual_date: settlement.actualDate,
  }
}

export function toUnsettleArgs(itemId: string, date: IsoDate): UnsettleArgs {
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

/** One row of `public.recent_settled_amounts()` (issue #18). */
export type SettledAmountRow =
  Database['public']['Functions']['recent_settled_amounts']['Returns'][number]

/**
 * Attaches each rule's settled history to it, as `RecurringItem.depositHistory`
 * — the read half of issue #18.
 *
 * `rows` come from `recent_settled_amounts()`, which already limits each rule
 * to the user's window; `recentHistory` applies `window` again here anyway, so
 * the domain's own bound holds even if the function's ever drifts from it.
 * Rows are re-sorted rather than trusted to arrive oldest first, their signed
 * amounts are turned into magnitudes by the rule's kind (`settledMagnitude`,
 * which drops anything that cannot be a deposit or a payment of this rule),
 * and a row naming a rule not in `items` is ignored — the same stance
 * `RunwayData.balanceHistory` takes for a reading naming an unknown account.
 *
 * No arithmetic on amounts beyond the sign: averaging is `resolveAmount`'s.
 */
export function withSettledHistory(
  items: readonly RecurringItem[],
  rows: readonly SettledAmountRow[] | null,
  window: number,
): RecurringItem[] {
  if (!rows || rows.length === 0) return [...items]

  const byRule = new Map<string, SettledAmountRow[]>()
  for (const row of rows) {
    const list = byRule.get(row.rule_id)
    if (list) list.push(row)
    else byRule.set(row.rule_id, [row])
  }

  return items.map((item) => {
    const settled = byRule.get(item.id)
    if (!settled) return item
    const magnitudes = [...settled]
      .sort((a, b) => compareDates(a.projected_date, b.projected_date))
      .map((row) => settledMagnitude(item.kind, row.actual_amount_cents))
      .filter((amount): amount is MinorUnits => amount !== null)
    return { ...item, depositHistory: recentHistory(magnitudes, window) }
  })
}
