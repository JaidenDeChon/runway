/**
 * The mapping layer for `public.occurrences`' one write path: the
 * `regenerate_occurrences` RPC (issue #9,
 * `supabase/migrations/20260904015555_occurrence_regeneration.sql`).
 *
 * Pure, no Nuxt imports, so `bun run test:unit` can cover it directly —
 * mirrors `app/lib/supabase/recurring-items.ts`'s shape. There is
 * deliberately no `toOccurrence` here: nothing in `app/` reads
 * `public.occurrences` yet (issue #15 owns that), so this file is
 * write-only. `tests/guards/occurrence-write-sites.test.ts` enforces that
 * `useRunwayData.ts` is the only caller of this RPC.
 */

import type { Database } from '#shared/supabase/database.types'
import type { DesiredOccurrence, MaterializationWindow } from '~~/domain/materialization'

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
