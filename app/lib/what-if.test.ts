/**
 * What-if scratch state (issue #16).
 *
 * The layering rules matter more than they look: a preview list that stacked
 * instead of replacing would let a retimed occurrence become unfindable by the
 * date it was edited at, and a list that stayed visible after the mode went
 * off would show invented numbers as if they were stored ones. Both are
 * checked here rather than in the page, because the page's `<script setup>`
 * block is not reachable from any test project this repo has.
 */

import { describe, expect, it } from 'vitest'
import type { IsoDate } from '~~/domain/dates'
import { toMinorUnits } from '~~/domain/money'
import { type OccurrenceEdit, occurrenceKey } from './occurrence-editor'
import {
  discardPrompt,
  EMPTY_SCRATCH,
  hasScratchEdits,
  overridesInEffect,
  PROMOTION_FAILED,
  PROMOTION_STALE,
  previewSummary,
  promotionFailureMessage,
  promotionPlan,
  scratchEntry,
  scratchKeys,
  withoutScratchEdit,
  withScratchEdit,
} from './what-if'

const edit = (over: Partial<OccurrenceEdit> = {}): OccurrenceEdit => ({
  itemId: 'rent',
  date: '2026-09-20' as IsoDate,
  scope: 'once',
  amount: toMinorUnits(-1200),
  projectedAmount: toMinorUnits(-1000),
  ...over,
})

describe('scratchEntry', () => {
  it('drops the write-only projectedAmount rather than carrying it', () => {
    // The isolation this file exists to keep: a preview holds what the
    // projection needs to show a change, never what a write needs to make one.
    // `override_occurrence`'s insert branch is the only consumer of
    // `projectedAmount`, and a preview never reaches it.
    expect(scratchEntry(edit())).not.toHaveProperty('projectedAmount')
  })

  it('keeps the projected date as the identity, and the signed amount as given', () => {
    expect(scratchEntry(edit())).toEqual({
      itemId: 'rent',
      date: '2026-09-20',
      scope: 'once',
      amount: toMinorUnits(-1200),
    })
  })

  it('omits newDate entirely when the occurrence did not move', () => {
    // Absent, not present-and-undefined: the domain compiles under
    // exactOptionalPropertyTypes and `applyOne` reads the key with `??`.
    expect(Object.hasOwn(scratchEntry(edit()), 'newDate')).toBe(false)
  })

  it('carries newDate when the occurrence was retimed', () => {
    expect(scratchEntry(edit({ newDate: '2026-09-25' as IsoDate })).newDate).toBe('2026-09-25')
  })
})

describe('withScratchEdit', () => {
  it('starts from nothing and accumulates', () => {
    const first = withScratchEdit(EMPTY_SCRATCH, edit())
    const second = withScratchEdit(first, edit({ itemId: 'salary', amount: toMinorUnits(3000) }))
    expect(second.map((entry) => entry.itemId)).toEqual(['rent', 'salary'])
  })

  it('replaces an earlier preview of the same occurrence instead of stacking on it', () => {
    const once = withScratchEdit(EMPTY_SCRATCH, edit({ amount: toMinorUnits(-1200) }))
    const twice = withScratchEdit(once, edit({ amount: toMinorUnits(-1500) }))
    expect(twice).toHaveLength(1)
    expect(twice[0]?.amount).toBe(toMinorUnits(-1500))
  })

  it('replaces across scopes too, so nothing invisible survives to be promoted', () => {
    // The domain's `withOverride` keeps these apart, and is right to: for the
    // engine, "later wins" makes the superseded entry harmless. For a list
    // that can be saved it is not harmless — the `once` here is already
    // invisible on the chart, and promoting it would write an occurrence
    // override the user was never shown.
    const once = withScratchEdit(EMPTY_SCRATCH, edit({ scope: 'once' }))
    const then = withScratchEdit(once, edit({ scope: 'future' }))
    expect(then).toHaveLength(1)
    expect(then[0]?.scope).toBe('future')
  })

  it('keeps previews of different days apart even at the same scope', () => {
    const list = withScratchEdit(
      withScratchEdit(EMPTY_SCRATCH, edit({ date: '2026-09-20' as IsoDate })),
      edit({ date: '2026-10-20' as IsoDate }),
    )
    expect(list.map((entry) => entry.date)).toEqual(['2026-09-20', '2026-10-20'])
  })

  it('appends rather than prepends, so the newest preview wins under applyOverrides', () => {
    const list = withScratchEdit(
      withScratchEdit(EMPTY_SCRATCH, edit({ itemId: 'a' })),
      edit({ itemId: 'b' }),
    )
    expect(list.at(-1)?.itemId).toBe('b')
  })

  it('does not mutate the list it was given', () => {
    const before = withScratchEdit(EMPTY_SCRATCH, edit())
    const snapshot = [...before]
    withScratchEdit(before, edit({ itemId: 'salary' }))
    expect(before).toEqual(snapshot)
  })

  it('leaves EMPTY_SCRATCH itself empty, so the shared constant cannot be poisoned', () => {
    withScratchEdit(EMPTY_SCRATCH, edit())
    expect(EMPTY_SCRATCH).toHaveLength(0)
  })
})

describe('hasScratchEdits', () => {
  it('is false for a session that has previewed nothing', () => {
    expect(hasScratchEdits(EMPTY_SCRATCH)).toBe(false)
  })

  it('is true once something has been previewed', () => {
    expect(hasScratchEdits(withScratchEdit(EMPTY_SCRATCH, edit()))).toBe(true)
  })
})

describe('previewSummary', () => {
  it('names a state rather than a count when nothing has been previewed', () => {
    // The bar appears the moment the mode is switched on, before anything is
    // previewed; "0 previewed changes" there reads as a bug.
    expect(previewSummary(0)).toBe('Nothing previewed yet')
  })

  it('agrees with itself on the plural', () => {
    expect(previewSummary(1)).toBe('1 previewed change')
    expect(previewSummary(2)).toBe('2 previewed changes')
  })
})

describe('discardPrompt', () => {
  it('says "change" for one and "changes" for more', () => {
    expect(discardPrompt(1)).toContain('1 previewed change will')
    expect(discardPrompt(2)).toContain('2 previewed changes will')
  })

  it('says what is lost and stops there', () => {
    // The reassurance sentence was removed at the user's request
    // (2026-09-20); this pins the prompt to the count so it does not drift
    // back in.
    expect(discardPrompt(3)).toBe('3 previewed changes will be lost.')
  })
})

describe('promotionPlan', () => {
  const plan = (...edits: OccurrenceEdit[]) =>
    promotionPlan(edits.reduce<ReturnType<typeof withScratchEdit>>(withScratchEdit, []))

  it('maps "this occurrence only" to an occurrence override, signed as stored', () => {
    expect(plan(edit({ amount: toMinorUnits(-1200) }))).toEqual([
      { kind: 'override', itemId: 'rent', date: '2026-09-20', amount: toMinorUnits(-1200) },
    ])
  })

  it('maps "apply to all future" to a rule split at the positive magnitude', () => {
    // `recurring_rules.amount_cents` is unsigned — the rule's `kind` carries
    // the direction — while an occurrence's amount is signed. Getting this
    // backwards would turn a bill into income on every future date.
    expect(plan(edit({ scope: 'future', amount: toMinorUnits(-1200) }))).toEqual([
      {
        kind: 'split',
        itemId: 'rent',
        effectiveFrom: '2026-09-20',
        amount: toMinorUnits(1200),
      },
    ])
  })

  it('carries a retime on an override', () => {
    const [step] = plan(edit({ newDate: '2026-09-25' as IsoDate }))
    expect(step).toMatchObject({ kind: 'override', newDate: '2026-09-25' })
  })

  it('drops a retime on a split, as the engine does', () => {
    // Apply-to-future is an amount rule; a rule split cannot express retiming
    // an unbounded series, and the editor disables the date field for it.
    const [step] = plan(edit({ scope: 'future', newDate: '2026-09-25' as IsoDate }))
    expect(step).not.toHaveProperty('newDate')
  })

  it('keeps the order the user made the edits in', () => {
    // Not grouped by kind: a split regenerates its rule's occurrences, so the
    // sequence decides the result, and replaying the user's own sequence is
    // what makes a promotion identical to the same edits made directly.
    const steps = plan(
      edit({ itemId: 'rent', scope: 'future' }),
      edit({ itemId: 'salary', scope: 'once' }),
      edit({ itemId: 'gym', scope: 'future' }),
    )
    expect(steps.map((step) => [step.kind, step.itemId])).toEqual([
      ['split', 'rent'],
      ['override', 'salary'],
      ['split', 'gym'],
    ])
  })

  it('plans nothing for an untouched session', () => {
    expect(promotionPlan(EMPTY_SCRATCH)).toEqual([])
  })

  it('carries no projectedAmount, which the page must supply at write time', () => {
    // The field exists only for `override_occurrence`'s insert branch and is
    // dropped on the way into the scratch list; a stale copy here would be
    // written to the row.
    expect(plan(edit())[0]).not.toHaveProperty('projectedAmount')
  })
})

describe('overridesInEffect', () => {
  it('shows the scratch list while the mode is on', () => {
    const scratch = withScratchEdit(EMPTY_SCRATCH, edit())
    expect(overridesInEffect(true, scratch)).toEqual(scratch)
  })

  it('hides a non-empty scratch list the moment the mode goes off', () => {
    // The direction a mistake has to fail in: "off" shows stored data even if
    // the list was never cleared.
    const scratch = withScratchEdit(EMPTY_SCRATCH, edit())
    expect(overridesInEffect(false, scratch)).toHaveLength(0)
  })

  it('is empty either way when nothing has been previewed', () => {
    expect(overridesInEffect(true, EMPTY_SCRATCH)).toHaveLength(0)
    expect(overridesInEffect(false, EMPTY_SCRATCH)).toHaveLength(0)
  })
})

describe('promotionFailureMessage', () => {
  it('names the real cause when the occurrence is gone, rather than blaming the network', () => {
    // `useRunwayData`'s `throwForRpcError` turns the RPC's PT404 into this
    // marker. Nothing consumed it before issue #16's promotion path, so a
    // vanished occurrence was reported as a connection problem and sent the
    // user to check their wifi over a stale forecast.
    expect(promotionFailureMessage(new Error('save-failed-gone'))).toBe(PROMOTION_STALE)
  })

  it('falls back to the write failure for any other error', () => {
    expect(promotionFailureMessage(new Error('save-failed'))).toBe(PROMOTION_FAILED)
  })

  it('does not mistake a non-Error rejection for a stale day', () => {
    // A thrown string or a rejected `undefined` must not reach the branch
    // that tells somebody their day left the forecast.
    expect(promotionFailureMessage('save-failed-gone')).toBe(PROMOTION_FAILED)
    expect(promotionFailureMessage(undefined)).toBe(PROMOTION_FAILED)
  })

  it('keeps the two messages distinguishable', () => {
    // They are two different instructions to the user; collapsing them into
    // one string would make this mapping pointless.
    expect(PROMOTION_STALE).not.toBe(PROMOTION_FAILED)
  })
})

describe('withoutScratchEdit', () => {
  it('drops the preview of one occurrence and leaves the rest standing', () => {
    const scratch = withScratchEdit(
      withScratchEdit(EMPTY_SCRATCH, edit()),
      edit({ itemId: 'power', date: '2026-09-24' as IsoDate }),
    )
    const kept = withoutScratchEdit(scratch, 'rent', '2026-09-20' as IsoDate)
    expect(kept.map((entry) => entry.itemId)).toEqual(['power'])
  })

  it('drops it at either scope, matching how withScratchEdit keys them', () => {
    // The pair has to agree: if adding replaces a `once` preview with a
    // `future` one on the same occurrence, removing cannot leave a `future`
    // entry behind that the row no longer has any way to show.
    const scratch = withScratchEdit(EMPTY_SCRATCH, edit({ scope: 'future' }))
    expect(withoutScratchEdit(scratch, 'rent', '2026-09-20' as IsoDate)).toEqual([])
  })

  it('keeps the same rule on another date', () => {
    // `(itemId, date)`, not `itemId`: resetting September's rent must not
    // discard the preview of October's.
    const scratch = withScratchEdit(EMPTY_SCRATCH, edit())
    expect(withoutScratchEdit(scratch, 'rent', '2026-10-20' as IsoDate)).toHaveLength(1)
  })

  it('is a no-op on a list holding nothing for that occurrence', () => {
    expect(withoutScratchEdit(EMPTY_SCRATCH, 'rent', '2026-09-20' as IsoDate)).toEqual([])
  })
})

describe('scratchKeys', () => {
  it('keys previews the way a row identifies itself', () => {
    // The row and the scratch list must spell the identity the same way, or a
    // previewed row would render as an unpreviewed one.
    const scratch = withScratchEdit(EMPTY_SCRATCH, edit())
    expect(scratchKeys(scratch).has(occurrenceKey('rent', '2026-09-20' as IsoDate))).toBe(true)
  })

  it('does not claim an occurrence nothing is previewing', () => {
    expect(scratchKeys(EMPTY_SCRATCH).has(occurrenceKey('rent', '2026-09-20' as IsoDate))).toBe(
      false,
    )
  })
})
