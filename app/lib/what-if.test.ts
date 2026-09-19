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
import type { OccurrenceEdit } from './occurrence-editor'
import {
  discardPrompt,
  EMPTY_SCRATCH,
  hasScratchEdits,
  overridesInEffect,
  previewSummary,
  scratchEntry,
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

  it('treats the same day at a different scope as a different preview', () => {
    // "This occurrence only" and "all future" are different edits that happen
    // to share a date; collapsing them would silently drop one.
    const once = withScratchEdit(EMPTY_SCRATCH, edit({ scope: 'once' }))
    const both = withScratchEdit(once, edit({ scope: 'future' }))
    expect(both.map((entry) => entry.scope)).toEqual(['once', 'future'])
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

  it('reassures that nothing stored is at stake, which is what makes Discard safe to press', () => {
    expect(discardPrompt(3)).toContain('saved data is untouched')
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
