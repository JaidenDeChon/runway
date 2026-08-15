import { describe, expect, it } from 'vitest'
import { sumMinorUnits, toMajorUnits, toMinorUnits } from './money'

describe('money', () => {
  it('round-trips major <-> minor units', () => {
    expect(toMinorUnits(19.99)).toBe(1999)
    expect(toMajorUnits(1999)).toBe(19.99)
  })

  it('sums minor-units values exactly', () => {
    expect(sumMinorUnits([toMinorUnits(19.99), toMinorUnits(0.01), toMinorUnits(10)])).toBe(3000)
  })
})
