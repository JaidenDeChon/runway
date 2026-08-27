/**
 * The projection engine's performance budget.
 *
 * The budget is a product constraint, not a vanity number. The dashboard
 * reprojects on every reactive change — toggling an account, dragging a what-if
 * amount, switching the 30/60/90 horizon — and each of those has to land inside
 * a frame with the chart's own work still to do. **5 ms for a 90-day projection
 * across 5 accounts** leaves the render the rest of the 16 ms and then some.
 *
 * Measured at ~0.12 ms on an Apple-silicon laptop under Bun 1.3, so the ceiling
 * is roughly forty times the observed cost. That margin is deliberate: a CI
 * runner is a shared, noisy machine, and a benchmark that fails on a busy
 * afternoon gets deleted rather than investigated. What this catches is not a
 * 20% regression — it is somebody making the walk quadratic.
 *
 * See `docs/engine/README.md` for the recorded figures.
 */

import { describe, expect, it } from 'vitest'
import { GOLDEN_SCENARIOS } from '../../domain/fixtures/scenarios'
import { project } from '../../domain/projection'

/** Median of `runs` timed calls, after a warm-up the JIT gets to keep. */
function medianMillis(run: () => unknown, runs = 100): number {
  for (let i = 0; i < 50; i++) run()
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY
}

const ninetyDays = GOLDEN_SCENARIOS.find(
  (scenario) => scenario.name === 'ninety-days-five-accounts',
)
// Thrown at import rather than asserted away with `!`: a benchmark that
// silently measured nothing would report a very good number.
if (!ninetyDays) throw new Error('golden scenario ninety-days-five-accounts is missing')

/** The issue's stated budget: 90 days, 5 accounts. */
const BUDGET_MS = 5

/** Two years of the same portfolio, to catch a walk that stopped being linear. */
const LONG_BUDGET_MS = 20

describe('projection performance', () => {
  it('has the benchmark scenario it claims to measure', () => {
    expect(ninetyDays.data.accounts).toHaveLength(5)
    expect(project(ninetyDays.data, ninetyDays.window).days).toHaveLength(90)
  })

  it(`projects 90 days across 5 accounts within ${BUDGET_MS}ms`, () => {
    const median = medianMillis(() => project(ninetyDays.data, ninetyDays.window))
    expect(median).toBeLessThan(BUDGET_MS)
  })

  it('stays linear in the length of the window', () => {
    const short = medianMillis(() => project(ninetyDays.data, ninetyDays.window))
    const long = medianMillis(() =>
      project(ninetyDays.data, { start: '2026-01-01', end: '2027-12-31' }),
    )
    expect(long).toBeLessThan(LONG_BUDGET_MS)
    // 730 days is ~8x the window for ~6x the cost when the walk is linear. A
    // quadratic one would be nearer 60x, so the ceiling here separates the two
    // without being sensitive to how fast the machine is.
    expect(long / short).toBeLessThan(20)
  })
})
