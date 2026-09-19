/**
 * What-if scratch state — what a preview session holds, and what it is
 * deliberately incapable of (issue #16).
 *
 * What-if shows the shape of an edit before it is saved. It does that by
 * handing the engine the same stored records plus a list of previewed
 * overrides (`ProjectionWindow.overrides`), so a preview is a different
 * *window* onto the same data and never a second calculation path. This
 * module owns that list: how an editor payload becomes a scratch entry, how
 * entries layer, and when they are visible to the projection at all.
 *
 * It lives in `app/lib/` rather than inside `app/pages/index.vue` for the
 * reason `app/lib/occurrence-editor.ts` gives for itself: there is no
 * component test project in this repo, deliberately (`vitest.config.ts` says
 * so and why), and logic left in a `<script setup>` block is logic no unit
 * test can reach. Out here it is covered by `what-if.test.ts`, and
 * `tests/guards/what-if-write-isolation.test.ts` can state the isolation rule
 * as a fact about a file instead of a habit about a branch.
 *
 * **A scratch entry carries no write payload, on purpose.** An
 * `OccurrenceEdit` arrives from `DayDetailEditor.vue` carrying
 * `projectedAmount`, which exists for one reason: the insert branch of the
 * `override_occurrence` RPC needs the rule's own amount for a date that may
 * not be materialized yet. An `OccurrenceOverride` has no such field, so the
 * conversion below drops it. A preview therefore holds exactly what the
 * projection needs to *show* a change and nothing a write would need to
 * *make* one — the isolation is in the type, not only in the control flow.
 *
 * Nothing here is async, and nothing here can be: this module imports the
 * domain and its sibling payload types, and no client, fetch or storage API.
 * That is the property the guard test checks.
 */

import type { OccurrenceOverride } from '~~/domain/overrides'
import { withOverride } from '~~/domain/overrides'
import type { OccurrenceEdit } from './occurrence-editor'

/**
 * The previewed edits a what-if session is holding.
 *
 * Ordered, because `applyOverrides` resolves collisions by "later wins" and
 * the page appends this list after the stored one — a preview lands on top of
 * a saved edit rather than beside it.
 */
export type WhatIfScratch = readonly OccurrenceOverride[]

/** No previewed edits. The state a session starts in and the one discarding returns it to. */
export const EMPTY_SCRATCH: WhatIfScratch = []

/**
 * The preview an editor payload describes.
 *
 * `projectedAmount` is dropped rather than carried — see the note at the top
 * of this file. `newDate` is spread conditionally rather than assigned
 * `edit.newDate`, so an unmoved occurrence produces an override with no
 * `newDate` key at all rather than one holding `undefined` — the domain
 * compiles under `exactOptionalPropertyTypes` (`tsconfig.domain.json`), where
 * those are not the same value.
 */
export function scratchEntry(edit: OccurrenceEdit): OccurrenceOverride {
  return {
    itemId: edit.itemId,
    date: edit.date,
    scope: edit.scope,
    amount: edit.amount,
    ...(edit.newDate ? { newDate: edit.newDate } : {}),
  }
}

/**
 * Adds an editor payload to the scratch list, replacing any earlier preview of
 * the same occurrence at the same scope.
 *
 * Delegates the replacement rule to the domain's `withOverride` rather than
 * repeating it: editing one day twice is one override, and the reason is the
 * same whether the list is a preview or a saved one.
 */
export function withScratchEdit(
  scratch: WhatIfScratch,
  edit: OccurrenceEdit,
): OccurrenceOverride[] {
  return withOverride(scratch, scratchEntry(edit))
}

/**
 * Whether this session has anything to lose.
 *
 * The condition behind the exit confirmation: leaving an untouched what-if
 * session discards nothing and must not stop to ask.
 */
export function hasScratchEdits(scratch: WhatIfScratch): boolean {
  return scratch.length > 0
}

/**
 * The overrides the projection should see right now.
 *
 * Switching the mode off hides the list without needing to clear it, which is
 * what makes "off" a safe state to reach from anywhere: a caller that forgets
 * to empty the list still shows the user their real numbers. The page clears
 * it too, on the same transition — belt and braces, in the direction where a
 * mistake shows stored data rather than invented data.
 */
export function overridesInEffect(on: boolean, scratch: WhatIfScratch): WhatIfScratch {
  return on ? scratch : EMPTY_SCRATCH
}
