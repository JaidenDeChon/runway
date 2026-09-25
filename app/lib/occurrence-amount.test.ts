/**
 * The rules behind an Upcoming row's editable amount.
 *
 * The retime clause in `quickEdit` is the one worth the most here: it is the
 * difference between "change this amount" and "change this amount and put the
 * day back", and nothing on screen would say the second had happened until the
 * chart moved.
 */

import { describe, expect, it } from 'vitest'
import type { IsoDate } from '~~/domain/dates'
import { toMinorUnits } from '~~/domain/money'
import {
  amountFieldLabel,
  isAmountDirty,
  type QuickEditTarget,
  quickEdit,
  quickEditHint,
  resetEffect,
  resetLabel,
  updateAllLabel,
  updateOneLabel,
} from './occurrence-amount'

const target = (over: Partial<QuickEditTarget> = {}): QuickEditTarget => ({
  itemId: 'rent',
  date: '2026-09-20' as IsoDate,
  projectedDate: '2026-09-20' as IsoDate,
  projectedAmount: toMinorUnits(-1000),
  ...over,
})

describe('quickEdit', () => {
  it('addresses the write to the projected date, not the day the row is showing', () => {
    // `(rule_id, projected_date)` is the natural key, and it is the half that
    // survives a retime. Keying on `date` would re-key the write onto an
    // already-moved day.
    const edit = quickEdit(target({ date: '2026-09-22' as IsoDate }), toMinorUnits(-1200), 'one')
    expect(edit.date).toBe('2026-09-20')
  })

  it('carries the current date forward when the occurrence has already been moved', () => {
    // The regression this clause exists for: `override_occurrence` takes the
    // whole override, and an absent `newDate` means "lands on its projected
    // date". Without this, changing the amount of a moved occurrence would
    // silently un-move it.
    const edit = quickEdit(target({ date: '2026-09-22' as IsoDate }), toMinorUnits(-1200), 'one')
    expect(edit.newDate).toBe('2026-09-22')
  })

  it('omits newDate entirely for an occurrence sitting on its rule date', () => {
    // Absent, not present-and-undefined: `scratchEntry` spreads it
    // conditionally and the domain compiles under exactOptionalPropertyTypes.
    expect(Object.hasOwn(quickEdit(target(), toMinorUnits(-1200), 'one'), 'newDate')).toBe(false)
  })

  it('never carries a date into an apply-to-all, even from a moved occurrence', () => {
    // A rule split is amount-only; retiming an unbounded series is not
    // something it can express.
    const edit = quickEdit(target({ date: '2026-09-22' as IsoDate }), toMinorUnits(-1200), 'all')
    expect(Object.hasOwn(edit, 'newDate')).toBe(false)
  })

  it('maps the two buttons onto the two override scopes', () => {
    expect(quickEdit(target(), toMinorUnits(-1200), 'one').scope).toBe('once')
    expect(quickEdit(target(), toMinorUnits(-1200), 'all').scope).toBe('future')
  })

  it('keeps the amount signed and the rule value untouched', () => {
    // The field is signed like every amount in the app, and `projectedAmount`
    // is the rule's own figure the insert branch of the RPC needs — a
    // previewed or typed value there would corrupt the stored row.
    const edit = quickEdit(target(), toMinorUnits(-1200), 'one')
    expect(edit.amount).toBe(toMinorUnits(-1200))
    expect(edit.projectedAmount).toBe(toMinorUnits(-1000))
  })
})

describe('isAmountDirty', () => {
  it('is false when the field still holds the row', () => {
    expect(isAmountDirty(toMinorUnits(-1000), toMinorUnits(-1000))).toBe(false)
  })

  it('is true for a changed figure, including a flipped sign', () => {
    expect(isAmountDirty(toMinorUnits(-1200), toMinorUnits(-1000))).toBe(true)
    expect(isAmountDirty(toMinorUnits(1000), toMinorUnits(-1000))).toBe(true)
  })
})

describe('resetEffect', () => {
  const state = (over: Partial<Parameters<typeof resetEffect>[0]> = {}) => ({
    whatIf: false,
    previewed: false,
    isOverridden: false,
    isSettled: false,
    dirty: false,
    ...over,
  })

  it('drops the preview first, so the mode never reaches a write', () => {
    // A previewed row is very often also a stored-override row — the preview
    // layers on top of it. If `override` won here, Reset in what-if mode
    // would delete a saved edit the user only meant to stop previewing.
    expect(resetEffect(state({ whatIf: true, previewed: true, isOverridden: true }))).toBe(
      'preview',
    )
  })

  it('never reverts a stored override while the mode is on', () => {
    expect(resetEffect(state({ whatIf: true, isOverridden: true, dirty: true }))).toBe('draft')
  })

  it('reverts the stored override with the mode off', () => {
    expect(resetEffect(state({ isOverridden: true }))).toBe('override')
  })

  it('clears the typed value when there is nothing else to undo', () => {
    expect(resetEffect(state({ dirty: true }))).toBe('draft')
  })

  it('has nothing to do on an untouched, unedited row', () => {
    // The condition that disables the button — a Reset that does nothing is a
    // button that teaches people the row is broken.
    expect(resetEffect(state())).toBe('none')
  })
})

describe('the spoken labels', () => {
  const date = '2026-09-20' as IsoDate

  it('name the row, because fourteen "Amount" fields are indistinguishable', () => {
    expect(amountFieldLabel('Rent', date)).toBe('Rent on Sep 20 amount')
  })

  it('say how far each update reaches', () => {
    expect(updateOneLabel('Rent', date)).toBe('Update Rent on Sep 20 only')
    expect(updateAllLabel('Rent', date)).toBe('Update every Rent from Sep 20 onward')
  })

  it('say which of the three things Reset is about to do', () => {
    // The destructive one must not be silent: "Reset" alone would read the
    // same whether it dropped a preview or deleted a saved edit.
    expect(resetLabel('Rent', date, 'preview')).toContain('previewed')
    expect(resetLabel('Rent', date, 'override')).toContain('rule value')
    expect(resetLabel('Rent', date, 'draft')).toContain('typed')
  })

  it('keeps the three Reset labels distinguishable from one another', () => {
    const labels = (['preview', 'override', 'draft'] as const).map((effect) =>
      resetLabel('Rent', date, effect),
    )
    expect(new Set(labels).size).toBe(3)
  })
})

describe('quickEditHint', () => {
  const date = '2026-09-20' as IsoDate

  it('names the reach of both buttons when a press would write', () => {
    // "Update all" closes the rule and opens a successor, which is not
    // guessable from two words on a button.
    const hint = quickEditHint('Rent', date, false)
    expect(hint).toContain('Sep 20 alone')
    expect(hint).toContain('every Rent from Sep 20 onward')
  })

  it('says nothing is saved when the mode is on, rather than naming a reach', () => {
    const hint = quickEditHint('Rent', date, true)
    expect(hint).toContain('Previewed only')
    expect(hint).not.toContain('Rent')
  })
})
