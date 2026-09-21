/**
 * The rules behind the editable amount on an Upcoming row.
 *
 * The dashboard's Upcoming list used to be read-only: a row was a button, and
 * changing a figure meant opening the day editor, finding the item, typing,
 * choosing a scope and saving. This module holds what it takes to do the same
 * thing from the row itself — which payload each of the three buttons builds,
 * what Reset means in each state, and the copy that says so.
 *
 * Out here rather than in `OccurrenceAmountRow.vue` for the reason
 * `occurrence-editor.ts` gives for itself: there is no component test project
 * in this repo (`vitest.config.ts` says so and why), so a rule left in a
 * `<script setup>` block is a rule no test can reach. These are the rules
 * worth reaching — in particular `quickEdit`'s retime clause, which is the
 * difference between "change this amount" and "change this amount and
 * silently move the day back".
 *
 * No arithmetic on money happens here. `quickEdit` carries an amount the
 * field already produced in minor units and compares two of them; it never
 * adds, scales or converts one.
 */

import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import { formatDateShort } from './format'
import type { OccurrenceEdit } from './occurrence-editor'

/** Which of the two update buttons was pressed. */
export type QuickScope = 'one' | 'all'

/**
 * What the identity fields of a row's payload are built from — everything
 * `quickEdit` needs and nothing else, so its tests can state a case in four
 * lines instead of building a whole `Occurrence`.
 */
export interface QuickEditTarget {
  readonly itemId: string
  /** Where the occurrence sits now — post-override, so possibly retimed. */
  readonly date: IsoDate
  /** The rule's own day: half the natural key, and what a write is addressed to. */
  readonly projectedDate: IsoDate
  /** The rule's own signed amount for this date, before any override. */
  readonly projectedAmount: MinorUnits
}

/**
 * The edit one of the row's update buttons describes.
 *
 * **`newDate` is carried for an already-retimed occurrence, and that is not
 * optional.** `override_occurrence` takes the occurrence's whole override, not
 * a patch: `toOverrideArgs` sends `p_actual_date: null` when `newDate` is
 * absent, and the RPC reads that as "lands on its projected date". So an
 * inline amount change on an occurrence somebody had already moved would put
 * the day back as a side effect of typing a number — a retime nobody asked
 * for, invisible until the chart moved. Sending the date it is already on
 * makes the write say exactly what the row shows.
 *
 * Deliberately only for `one`. Apply-to-all is a rule split, which is
 * amount-only by construction (`domain/overrides.ts`, docs/database/schema.md
 * § "Rule splitting"), and the day editor's own date field disables itself for
 * the same reason.
 */
export function quickEdit(
  target: QuickEditTarget,
  amount: MinorUnits,
  scope: QuickScope,
): OccurrenceEdit {
  const retimed = scope === 'one' && target.date !== target.projectedDate
  return {
    itemId: target.itemId,
    date: target.projectedDate,
    scope: scope === 'one' ? 'once' : 'future',
    amount,
    projectedAmount: target.projectedAmount,
    ...(retimed ? { newDate: target.date } : {}),
  }
}

/**
 * Whether the field holds something other than what the row is showing.
 *
 * The condition behind both update buttons. A press that would write the
 * amount already on the row is not a no-op — `override_occurrence` would
 * insert a row marking it hand-edited — so the buttons disable rather than
 * letting somebody "save" an untouched figure into an `Edited` badge.
 */
export function isAmountDirty(draft: MinorUnits, current: MinorUnits): boolean {
  return draft !== current
}

/**
 * What Reset would actually do, given where the row stands.
 *
 * Four answers, in the order they are checked:
 *
 * - `preview` — what-if is on and this occurrence is previewed. Drops the
 *   preview, writing nothing. Checked first so the mode's own promise ("a
 *   preview never reaches storage") cannot be broken by a row that happens to
 *   also carry a saved override.
 * - `override` — what-if is off and the occurrence is hand-edited. Reverts it
 *   through `revert_occurrence`, exactly as the day editor's "Revert to rule
 *   value" does.
 * - `draft` — neither, but the field has been typed in. Puts the field back
 *   and stops there.
 * - `none` — nothing to undo, so the button disables rather than pretending.
 *
 * `preview` and `override` also clear the field, which is why `draft` is last
 * rather than first: with the mode on, typing over a previewed row and
 * pressing Reset should undo the preview too, not just the typing.
 */
export type ResetEffect = 'preview' | 'override' | 'draft' | 'none'

export function resetEffect(state: {
  readonly whatIf: boolean
  readonly previewed: boolean
  readonly isOverridden: boolean
  readonly dirty: boolean
}): ResetEffect {
  if (state.whatIf && state.previewed) return 'preview'
  if (!state.whatIf && state.isOverridden) return 'override'
  if (state.dirty) return 'draft'
  return 'none'
}

/**
 * The spoken name of a row's amount field.
 *
 * Fourteen fields called "Amount" are fourteen fields a screen reader user
 * cannot tell apart, and the date is what distinguishes two occurrences of the
 * same rule. `MoneyInput` appends "in dollars" to whatever it is given, so
 * this stops at the noun.
 */
export function amountFieldLabel(label: string, date: IsoDate): string {
  return `${label} on ${formatDateShort(date)} amount`
}

/**
 * The spoken names of the three buttons, for the same reason.
 *
 * The visible labels stay short — "Update one", "Update all", "Reset" — and
 * these say which row they belong to and, for the two that write, how far the
 * change reaches.
 */
export function updateOneLabel(label: string, date: IsoDate): string {
  return `Update ${label} on ${formatDateShort(date)} only`
}

export function updateAllLabel(label: string, date: IsoDate): string {
  return `Update every ${label} from ${formatDateShort(date)} onward`
}

export function resetLabel(label: string, date: IsoDate, effect: ResetEffect): string {
  const row = `${label} on ${formatDateShort(date)}`
  if (effect === 'preview') return `Discard the previewed change to ${row}`
  if (effect === 'override') return `Revert ${row} to its rule value`
  return `Undo the typed amount for ${row}`
}

/**
 * The one line under a row whose amount has been changed but not yet applied.
 *
 * It exists because "Update all" is the most consequential button on this
 * screen and the cheapest to press by accident: it closes the rule and opens a
 * successor (docs/database/schema.md § "Rule splitting"), which is not
 * guessable from two words. The day editor answers this with
 * `splitConsequence`, a full sentence naming the cadence and the closing date;
 * a row cannot afford that much text fourteen times over, so this is the short
 * form — the reach of each button, and nothing else.
 *
 * With what-if on it says the other thing that matters, which is that neither
 * button writes anything at all.
 */
export function quickEditHint(label: string, date: IsoDate, whatIf: boolean): string {
  const day = formatDateShort(date)
  if (whatIf) return 'Previewed only — nothing is saved until you save the what-if session.'
  return `Update one changes ${day} alone. Update all changes every ${label} from ${day} onward.`
}
