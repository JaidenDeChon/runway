import { describe, expect, it } from 'vitest'
import { MINUS } from './format'
import { applyTyped, draftFor, draftValue, isNegative, sanitize, withSign } from './money-input'

describe('draftFor', () => {
  it('round-trips a stored amount through the draft and back', () => {
    for (const cents of [0, 1, 150_000, -150_000, -1, 81_234]) {
      expect(draftValue(draftFor(cents))).toBe(cents)
    }
  })

  it('carries the sign, so an overdrawn balance opens the editor already negative', () => {
    expect(draftFor(-123_456)).toBe('-1234.56')
    expect(isNegative(draftFor(-123_456))).toBe(true)
    expect(isNegative(draftFor(123_456))).toBe(false)
  })
})

describe('draftValue', () => {
  it('reads a half-typed entry as what has been typed so far', () => {
    // Every keystroke of "12.5" in order. None of them may throw the field
    // into an error state or blank the value the user is building.
    expect(draftValue('1')).toBe(100)
    expect(draftValue('12')).toBe(1_200)
    expect(draftValue('12.')).toBe(1_200)
    expect(draftValue('12.5')).toBe(1_250)
  })

  it('reads a lone minus as zero, so toggling an empty field is worth nothing', () => {
    expect(draftValue('-')).toBe(0)
    expect(draftValue('')).toBe(0)
    expect(draftValue('.')).toBe(0)
  })

  it('coerces a non-numeric entry to 0 rather than erroring, matching the design', () => {
    expect(draftValue('abc')).toBe(0)
  })

  it('never produces a signed zero', () => {
    // `-0` survives Math.round and would reach `balance_cents` as a signed
    // zero, then render through a `< 0` check as the wrong thing.
    expect(Object.is(draftValue('-0'), 0)).toBe(true)
    expect(Object.is(draftValue('-0.00'), 0)).toBe(true)
    expect(Object.is(draftValue('-'), 0)).toBe(true)
  })

  it('stays in integer cents for a value with cents', () => {
    expect(draftValue('812.34')).toBe(81_234)
    expect(draftValue('-812.34')).toBe(-81_234)
  })
})

describe('sanitize', () => {
  it('keeps a typed minus when the field allows one', () => {
    expect(sanitize('-500', true)).toBe('-500')
    expect(draftValue(sanitize('-500', true))).toBe(-50_000)
  })

  it('accepts the typographic minus the app renders, not just the keyboard hyphen', () => {
    expect(sanitize(`${MINUS}500`, true)).toBe('-500')
  })

  it('drops the sign but keeps the digits when the field cannot hold a negative', () => {
    // A safety cushion and a recurring item's amount are both non-negative in
    // the schema. Reading "-50" as 0 would throw away digits the user typed.
    expect(sanitize('-50', false)).toBe('50')
    expect(draftValue(sanitize('-50', false))).toBe(5_000)
  })

  it('strips a pasted currency string down to a number', () => {
    expect(sanitize('-$1,234.56', true)).toBe('-1234.56')
    expect(sanitize('$1,234.56', true)).toBe('1234.56')
    expect(sanitize('  2 000 ', true)).toBe('2000')
  })

  it('folds a second decimal point in rather than dropping the cents', () => {
    expect(sanitize('1.2.3', true)).toBe('1.23')
  })

  it('preserves a trailing decimal point mid-entry', () => {
    expect(sanitize('12.', true)).toBe('12.')
  })

  it('leaves a lone minus alone so the digits can follow it', () => {
    expect(sanitize('-', true)).toBe('-')
    expect(sanitize('-', false)).toBe('')
  })
})

describe('applyTyped', () => {
  it('keeps a negative amount negative when the next keystroke arrives', () => {
    // The regression this function exists for. The field renders the magnitude
    // only, so a keystroke reports "750" whether the amount is 750 or -750;
    // reading that literally turned −$75 into $750 on the way to the database.
    expect(applyTyped('-75', '750', true)).toBe('-750')
    expect(draftValue(applyTyped('-75', '750', true))).toBe(-75_000)
  })

  it('lets a typed minus turn the sign on', () => {
    expect(applyTyped('42', '-42', true)).toBe('-42')
  })

  it('leaves a positive amount positive', () => {
    expect(applyTyped('75', '750', true)).toBe('750')
  })

  it('survives clearing the field and starting again, still negative', () => {
    // Select-all-delete then retype. The sign is a separate control and the
    // user did not touch it, so it stands.
    expect(applyTyped('-75', '', true)).toBe('-')
    expect(applyTyped('-', '9', true)).toBe('-9')
  })

  it('carries no sign at all where the field cannot hold one', () => {
    expect(applyTyped('300', '-300', false)).toBe('300')
    expect(applyTyped('-300', '300', false)).toBe('300')
  })

  it('still normalizes a pasted currency string', () => {
    expect(applyTyped('0', '-$1,234.56', true)).toBe('-1234.56')
    expect(applyTyped('-0', '$1,234.56', true)).toBe('-1234.56')
  })
})

describe('withSign', () => {
  it('is the sign toggle: flipping twice returns the original draft', () => {
    expect(withSign(withSign('1234.56', true), false)).toBe('1234.56')
  })

  it('is idempotent — setting a sign a draft already has changes nothing', () => {
    expect(withSign('-500', true)).toBe('-500')
    expect(withSign('500', false)).toBe('500')
  })

  it('leaves a bare minus on an empty field, ready for the digits', () => {
    expect(withSign('', true)).toBe('-')
    expect(draftValue(withSign('', true))).toBe(0)
    // …and the keypad's digits land after it, which is the whole iOS path.
    expect(draftValue(sanitize('-500', true))).toBe(-50_000)
  })

  it('drives the value negative and back without touching the magnitude', () => {
    expect(draftValue(withSign('812.34', true))).toBe(-81_234)
    expect(draftValue(withSign('-812.34', false))).toBe(81_234)
  })
})

describe('isNegative', () => {
  it('reads the sign the toggle renders', () => {
    expect(isNegative('-1')).toBe(true)
    expect(isNegative(`${MINUS}1`)).toBe(true)
    expect(isNegative('-')).toBe(true)
    expect(isNegative('1')).toBe(false)
    expect(isNegative('')).toBe(false)
    // Not a leading sign — "1-2" is a typo, not a negative amount.
    expect(isNegative('1-2')).toBe(false)
  })
})
