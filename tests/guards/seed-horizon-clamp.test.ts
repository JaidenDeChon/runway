/**
 * `supabase/seed.sql`'s occurrence generator clamps to one hardcoded horizon,
 * `date '2026-12-31'`, written six times across its two `insert` statements —
 * `tests/rls/seed-fidelity.test.ts`'s `SEED_HORIZON_END` is the same value,
 * kept in step by nothing but this file.
 *
 * That duplication is exactly the gap `tests/rls/seed-fidelity.test.ts`'s own
 * `actualForComparison` cannot close (see its doc comment, issue #67 and
 * issue #90's adversarial review): a clamp *widened* rather than removed —
 * `2026-12-31` typo'd to `2027-12-31` in one of the six spots — generates
 * dates that are, by construction, cadence-consistent, since the seed's own
 * generator still steps correctly, just for longer than intended. Those dates
 * are indistinguishable from a real session's legitimate materialization
 * surplus by date content alone, so no runtime comparison against
 * `public.occurrences` can catch this specific bug shape without either
 * disabling the client-side horizon top-up during tests (which issue #67's
 * own AC3 rules out) or adding schema-level provenance tracking (out of
 * scope for a test-file fix).
 *
 * What *can* catch it is reading the source rather than its output: the
 * SQL's own six literals must still, and always, agree with the TypeScript
 * constant that describes them. If a future edit changes one clamp's date —
 * whether by typo or by deliberately extending the seed's horizon in one
 * `insert` and forgetting the other — this fails, naming the mismatch,
 * before `db:reset` ever runs the broken SQL.
 *
 * No database, no Nuxt boot, no live stack — it opens `supabase/seed.sql` and
 * counts, the same shape as `tests/guards/occurrence-write-sites.test.ts`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Mirrors `tests/rls/seed-fidelity.test.ts`'s own `SEED_HORIZON_END`.
 *
 * Not imported from that file: it is declared as a plain string literal
 * there too (not itself derived from anything), so importing it would still
 * leave this guard proving nothing more than "the constant equals itself".
 * Two independently-written copies of the same value is what actually
 * exercises the property — if `seed-fidelity.test.ts` changes its horizon
 * and this file is not updated to match, the count assertion below reads the
 * *old* value against the *new* SQL and fails, which is the guard doing its
 * job on itself.
 */
const SEED_HORIZON_END = '2026-12-31'

/**
 * The exact number of times the horizon clamp appears in `supabase/seed.sql`
 * today: three `least(coalesce(r.ends_on, date '…'), date '…')` clamps — the
 * weekly/biweekly insert's `generate_series` bound, and the monthly/annual
 * insert's `generate_series` bound and its `where` clause — each writing the
 * literal twice (the `ends_on` fallback, and the outer clamp). 3 × 2 = 6.
 *
 * A change to this number is not itself wrong — the seed generator's shape
 * can legitimately change — but it must be a deliberate edit to this
 * constant, not something that happens to make the test below pass by
 * accident with the wrong count.
 */
const EXPECTED_CLAMP_COUNT = 6

describe('supabase/seed.sql never lets its horizon clamp drift from SEED_HORIZON_END', () => {
  it('writes the same date literal everywhere it clamps the occurrence generator', () => {
    const seedSqlPath = fileURLToPath(new URL('../../supabase/seed.sql', import.meta.url))
    const seedSql = readFileSync(seedSqlPath, 'utf8')

    // Counted, not merely searched for with `.includes()` — a clamp that
    // names a *different* date instead would simply stop matching this
    // pattern rather than fail an existence check, so only a count catches a
    // single wrong literal among several correct ones.
    const clampPattern = new RegExp(`date '${SEED_HORIZON_END}'`, 'g')
    const matches = seedSql.match(clampPattern) ?? []

    expect(
      matches.length,
      `expected every occurrence-generator clamp in supabase/seed.sql to read ` +
        `date '${SEED_HORIZON_END}' (matching tests/rls/seed-fidelity.test.ts's own ` +
        `SEED_HORIZON_END) — found ${matches.length}, expected ${EXPECTED_CLAMP_COUNT}. ` +
        `If the seed's horizon changed deliberately, update SEED_HORIZON_END in both ` +
        `this file and tests/rls/seed-fidelity.test.ts to match.`,
    ).toBe(EXPECTED_CLAMP_COUNT)
  })
})
