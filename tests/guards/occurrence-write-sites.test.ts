/**
 * Structural half of the safety argument in
 * `supabase/migrations/20260904015555_occurrence_regeneration.sql` and
 * `supabase/migrations/20260913090000_occurrence_overrides_and_rule_split.sql`:
 * every protection guarantee for `public.occurrences` lives inside
 * `regenerate_occurrences` / `override_occurrence` / `revert_occurrence` /
 * `split_recurring_rule`, and that argument only holds if nothing else in
 * `app/` can write the table around them.
 *
 * **Widened for issue #15, deliberately, in both directions at once.** Before
 * this issue the rule was "one write path": no file but
 * `app/lib/supabase/occurrences.ts` may even mention `from('occurrences')`.
 * Issue #15 adds the overlay read (`RunwayData.occurrenceOverrides`), and
 * that read has to live in `composables/useRunwayData.ts` — the seam every
 * other mutation already lives in — so the old blanket ban would have to
 * change or the feature could not be built inside this file's own rule.
 * Loosening it by simply adding `useRunwayData.ts` to the same allowlist
 * `occurrences.ts` has would be a real regression: it would let that file
 * `.update(` or `.delete(` the table too, silently, with nothing here to
 * catch it. So the rule is now "one write path **and** one read path": this
 * file still allows `from('occurrences')` in `useRunwayData.ts`, but only
 * when it is a read — every occurrence of the pattern in that file's source
 * must be immediately followed by `.select(`. A future `.update(`/`.delete(`
 * chained off `from('occurrences')` anywhere in that file turns this guard
 * red, exactly as a new write elsewhere in `app/` already would.
 *
 * The RPC allowlist grows to name all four functions
 * `useRunwayData.ts` alone may call, each with its own positive assertion —
 * "the guard cannot pass by nobody calling it at all" — matching the one
 * `regenerate_occurrences` already had.
 *
 * No database, no Nuxt boot — it opens files and reads them, the same shape
 * as `tests/domain/purity.test.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url))

interface SourceFile {
  /** Path relative to `app/`, so a failure names `composables/useRunwayData.ts`, not the absolute path. */
  readonly name: string
  readonly text: string
}

function collectSourceFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    if (!/\.(ts|vue)$/.test(entry.name) || entry.name.endsWith('.test.ts')) return []
    return [{ name: relative(APP_DIR, path), text: readFileSync(path, 'utf8') }]
  })
}

const sourceFiles = collectSourceFiles(APP_DIR)

const OCCURRENCES_MAPPING_FILE = 'lib/supabase/occurrences.ts'
const SEAM_FILE = 'composables/useRunwayData.ts'

/**
 * Matches `.rpc('regenerate_occurrences'` even when Biome's formatter has put
 * the string argument on its own line (as it does for `useRunwayData.ts`'s
 * own calls) — `\s*` tolerates the newline and indentation between `rpc(` and
 * the string. One entry per RPC only `useRunwayData.ts` may call.
 */
const RPC_CALLS: Record<string, RegExp> = {
  regenerate_occurrences: /rpc\(\s*['"]regenerate_occurrences['"]/,
  override_occurrence: /rpc\(\s*['"]override_occurrence['"]/,
  revert_occurrence: /rpc\(\s*['"]revert_occurrence['"]/,
  split_recurring_rule: /rpc\(\s*['"]split_recurring_rule['"]/,
}

/** `from('occurrences')`, tolerating Biome's line breaks the same way the RPC patterns do. */
const FROM_OCCURRENCES = /from\(\s*['"]occurrences['"]\s*\)/g
/** The same, but only when immediately followed by `.select(` — a read, never a write. */
const FROM_OCCURRENCES_SELECT = /from\(\s*['"]occurrences['"]\s*\)\s*\.select\(/g

describe('public.occurrences has exactly one write path and one read path', () => {
  it('has source files to check, so a silent glob failure cannot pass', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
    expect(sourceFiles.map((file) => file.name)).toContain(SEAM_FILE)
    expect(sourceFiles.map((file) => file.name)).toContain(OCCURRENCES_MAPPING_FILE)
  })

  it("only app/lib/supabase/occurrences.ts and app/composables/useRunwayData.ts mention from('occurrences')", () => {
    const offenders = sourceFiles
      .filter((file) => file.name !== OCCURRENCES_MAPPING_FILE && file.name !== SEAM_FILE)
      .filter((file) => file.text.includes("from('occurrences')"))
      .map((file) => file.name)
    expect(offenders).toEqual([])
  })

  it("app/composables/useRunwayData.ts's from('occurrences') is a read every time — one .select( per mention, never an .update( or .delete(", () => {
    const seam = sourceFiles.find((file) => file.name === SEAM_FILE)
    const mentions = seam?.text.match(FROM_OCCURRENCES)?.length ?? 0
    const selects = seam?.text.match(FROM_OCCURRENCES_SELECT)?.length ?? 0
    // Both sides greater than zero, not just equal, so this cannot pass by the
    // overlay read having been deleted rather than kept honest.
    expect(mentions).toBeGreaterThan(0)
    expect(selects).toBe(mentions)
  })

  for (const [name, pattern] of Object.entries(RPC_CALLS)) {
    it(`only app/composables/useRunwayData.ts calls rpc('${name}'`, () => {
      const offenders = sourceFiles
        .filter((file) => file.name !== SEAM_FILE)
        .filter((file) => pattern.test(file.text))
        .map((file) => file.name)
      expect(offenders).toEqual([])
    })

    it(`the one legitimate call site actually calls rpc('${name}'), so this guard cannot pass by nobody calling it at all`, () => {
      const caller = sourceFiles.find((file) => file.name === SEAM_FILE)
      expect(pattern.test(caller?.text ?? '')).toBe(true)
    })
  }
})
