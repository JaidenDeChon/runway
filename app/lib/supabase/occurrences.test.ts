import { describe, expect, it } from 'vitest'
import type { DesiredOccurrence, MaterializationWindow } from '~~/domain/materialization'
import { toRegenerationArgs } from './occurrences'

const window: MaterializationWindow = { start: '2026-06-05', end: '2027-09-03' }

const occurrence = (over: Partial<DesiredOccurrence> = {}): DesiredOccurrence => ({
  ruleId: 'rule-1',
  date: '2026-08-20',
  amount: -90_000,
  ...over,
})

describe('toRegenerationArgs', () => {
  it('carries the window straight through', () => {
    const args = toRegenerationArgs(['rule-1'], window, [])
    expect(args.p_window_start).toBe('2026-06-05')
    expect(args.p_window_end).toBe('2027-09-03')
  })

  it('unzips the desired set into three parallel, index-aligned arrays', () => {
    const desired = [
      occurrence({ ruleId: 'a', date: '2026-08-01', amount: -1_000 }),
      occurrence({ ruleId: 'b', date: '2026-08-02', amount: 2_000 }),
    ]
    const args = toRegenerationArgs(['a', 'b'], window, desired)

    expect(args.p_occurrence_rule_ids).toEqual(['a', 'b'])
    expect(args.p_occurrence_dates).toEqual(['2026-08-01', '2026-08-02'])
    expect(args.p_occurrence_amount_cents).toEqual([-1_000, 2_000])
  })

  it('de-duplicates p_rule_ids', () => {
    const args = toRegenerationArgs(['a', 'a', 'b'], window, [])
    expect(args.p_rule_ids).toEqual(['a', 'b'])
  })

  it('copies amounts through with no arithmetic — already signed by the caller', () => {
    const desired = [occurrence({ amount: -12_345 })]
    expect(toRegenerationArgs(['rule-1'], window, desired).p_occurrence_amount_cents).toEqual([
      -12_345,
    ])
  })

  it('handles an empty desired set — all three arrays empty, ruleIds still carried', () => {
    const args = toRegenerationArgs(['rule-1'], window, [])
    expect(args.p_occurrence_rule_ids).toEqual([])
    expect(args.p_occurrence_dates).toEqual([])
    expect(args.p_occurrence_amount_cents).toEqual([])
    expect(args.p_rule_ids).toEqual(['rule-1'])
  })

  it('handles an empty rule scope — an empty p_rule_ids array, not null', () => {
    const args = toRegenerationArgs([], window, [])
    expect(args.p_rule_ids).toEqual([])
  })

  it('every offered date falls inside the window it is paired with', () => {
    const desired = [
      occurrence({ date: window.start }),
      occurrence({ date: window.end }),
      occurrence({ date: '2026-12-25' }),
    ]
    const args = toRegenerationArgs(['rule-1'], window, desired)
    for (const date of args.p_occurrence_dates) {
      expect(date >= window.start && date <= window.end).toBe(true)
    }
  })
})
