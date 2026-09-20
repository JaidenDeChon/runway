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

import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { OccurrenceOverride } from '~~/domain/overrides'
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
 * **the same occurrence** — at either scope.
 *
 * Deliberately stricter than the domain's `withOverride`, which keys on
 * `(itemId, date, scope)` and so keeps a `once` and a `future` preview of the
 * same day side by side. That is right for the engine, where "later wins" is
 * a display rule and a superseded entry costs nothing. It is wrong for a list
 * that can be *promoted*.
 *
 * Preview rent on Sep 20 at 700 "this occurrence only", then preview it again
 * at 800 "apply to all future". The chart shows 800, because the later
 * override wins — the 700 is already invisible. Keep both and promotion
 * writes a 700 occurrence override the user was never shown, on top of the
 * split. Collapsing them means what gets saved is what was on screen, which
 * is the acceptance criterion promotion has to meet.
 *
 * Scope still belongs on the entry: it decides which *write* a promotion
 * makes. It just cannot be part of the identity of the thing being edited,
 * because the user is editing one occurrence either way.
 */
export function withScratchEdit(
  scratch: WhatIfScratch,
  edit: OccurrenceEdit,
): OccurrenceOverride[] {
  const entry = scratchEntry(edit)
  const kept = scratch.filter(
    (existing) => existing.itemId !== entry.itemId || existing.date !== entry.date,
  )
  return [...kept, entry]
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
 * How much a what-if session is holding, for the persistent bar (issue #16).
 *
 * Zero has its own sentence rather than "0 previewed changes", because the
 * bar appears the moment the mode is switched on — before anything has been
 * previewed — and a zero count reads as a bug rather than as a state.
 */
export function previewSummary(count: number): string {
  if (count === 0) return 'Nothing previewed yet'
  return `${count} previewed ${count === 1 ? 'change' : 'changes'}`
}

/**
 * What the discard confirmation says beneath its question (issue #16).
 *
 * Copy lives here rather than in the template for the reason
 * `occurrence-editor.ts`'s `splitConsequence` gives: a sentence with a
 * plural in it is logic, and logic in a template is logic no test covers.
 *
 * The second half matters more than the first. The thing a person actually
 * fears at this prompt is having broken something real, and the honest
 * answer is that they have not: a preview was never written, so discarding
 * costs them only the preview. Saying so is what makes "Discard" safe to
 * press — and what stops the confirmation from reading as a warning about
 * data loss it is not.
 */
export function discardPrompt(count: number): string {
  const changes = count === 1 ? 'change' : 'changes'
  return `${count} previewed ${changes} will be lost. Your saved data is untouched either way.`
}

/**
 * One write a promotion will make.
 *
 * `override` needs a `projectedAmount` that this module cannot know — see
 * `scratchEntry`, which drops it on the way in — so the plan deliberately
 * stops short of a complete RPC payload. The page fills that field in as it
 * executes, reading the rule's own figure out of the projection at the
 * moment of the write rather than from a snapshot taken before the earlier
 * writes in the plan moved it.
 */
export type PromotionStep =
  | {
      readonly kind: 'override'
      readonly itemId: string
      readonly date: IsoDate
      /** Signed, as stored: `override_occurrence` takes the occurrence's own sign. */
      readonly amount: MinorUnits
      readonly newDate?: IsoDate
    }
  | {
      readonly kind: 'split'
      readonly itemId: string
      readonly effectiveFrom: IsoDate
      /** Positive magnitude: `recurring_rules.amount_cents` is unsigned, the rule's `kind` carries direction. */
      readonly amount: MinorUnits
    }

/**
 * What promoting this session would write, in the order it would write it
 * (issue #16).
 *
 * Separated from the page so the decisions are testable: which RPC each
 * scope maps to, the sign conversion a split needs, and the order. Only the
 * I/O is left in `index.vue`.
 *
 * **Order is the list's order, which is the order the user made the edits.**
 * Not grouped by kind and not parallel. Two edits can touch one rule and a
 * split regenerates that rule's occurrences, so the sequence is what decides
 * the result — and replaying the user's own sequence is precisely what makes
 * a promoted outcome identical to having made those same edits directly with
 * the mode off, which is the issue's acceptance criterion.
 *
 * A `future` preview ignores `newDate` here exactly as the engine does:
 * apply-to-future is an amount rule, and retiming an unbounded series is not
 * something a rule split can express (`domain/overrides.ts`,
 * docs/database/schema.md § "Rule splitting").
 */
export function promotionPlan(scratch: WhatIfScratch): PromotionStep[] {
  return scratch.map((override) =>
    override.scope === 'future'
      ? {
          kind: 'split',
          itemId: override.itemId,
          effectiveFrom: override.date,
          amount: Math.abs(override.amount) as MinorUnits,
        }
      : {
          kind: 'override',
          itemId: override.itemId,
          date: override.date,
          amount: override.amount,
          ...(override.newDate ? { newDate: override.newDate } : {}),
        },
  )
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

/**
 * What a promotion says when the day it was about has left the forecast.
 *
 * Distinct from `PROMOTION_FAILED` on purpose: this is not a connection
 * problem, and telling somebody to check their network when the horizon moved
 * under them sends them after the wrong thing.
 */
export const PROMOTION_STALE =
  'That day is no longer in the forecast, so it could not be saved. Reopen the day and try again.'

/** What a promotion says when the write itself did not land. */
export const PROMOTION_FAILED = 'Could not save those changes. Check your connection and try again.'

/**
 * Which of the two a failed promotion should show (issue #16).
 *
 * `useRunwayData()` already distinguishes these: `throwForRpcError` turns the
 * RPC's `PT404` — the occurrence is gone — into `save-failed-gone`, and
 * everything else into `save-failed`. Nothing consumed that distinction until
 * now, so an occurrence that had vanished was reported as a network problem.
 *
 * Out here rather than in the page's `catch` for this file's usual reason:
 * there is no component test project, so a mapping left in `index.vue` is a
 * mapping no unit test can reach.
 */
export function promotionFailureMessage(error: unknown): string {
  return error instanceof Error && error.message === 'save-failed-gone'
    ? PROMOTION_STALE
    : PROMOTION_FAILED
}
