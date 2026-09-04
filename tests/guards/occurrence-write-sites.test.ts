/**
 * Structural half of the safety argument in
 * `supabase/migrations/20260904015555_occurrence_regeneration.sql`: every
 * protection guarantee for `public.occurrences` lives inside
 * `public.regenerate_occurrences`, and that argument only holds if nothing
 * else in `app/` can write the table around it.
 *
 * This reads every `.ts` and `.vue` file under `app/` and fails if any file
 * other than `app/lib/supabase/occurrences.ts` mentions `from('occurrences')`,
 * or if any file other than `app/composables/useRunwayData.ts` calls
 * `.rpc('regenerate_occurrences')`. A future call site that reaches around
 * the seam is a red unit test here, not a review comment somebody has to catch.
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
const REGENERATION_CALL_SITE = 'composables/useRunwayData.ts'

/**
 * Matches `.rpc('regenerate_occurrences'` even when Biome's formatter has put
 * the string argument on its own line (as it does for `useRunwayData.ts`'s
 * own call) — `\s*` tolerates the newline and indentation between `rpc(` and
 * the string.
 */
const REGENERATE_RPC_CALL = /rpc\(\s*['"]regenerate_occurrences['"]/

describe('public.occurrences has exactly one write path', () => {
  it('has source files to check, so a silent glob failure cannot pass', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
    expect(sourceFiles.map((file) => file.name)).toContain(REGENERATION_CALL_SITE)
    expect(sourceFiles.map((file) => file.name)).toContain(OCCURRENCES_MAPPING_FILE)
  })

  it("only app/lib/supabase/occurrences.ts mentions from('occurrences')", () => {
    const offenders = sourceFiles
      .filter((file) => file.name !== OCCURRENCES_MAPPING_FILE)
      .filter((file) => file.text.includes("from('occurrences')"))
      .map((file) => file.name)
    expect(offenders).toEqual([])
  })

  it("only app/composables/useRunwayData.ts calls rpc('regenerate_occurrences'", () => {
    const offenders = sourceFiles
      .filter((file) => file.name !== REGENERATION_CALL_SITE)
      .filter((file) => REGENERATE_RPC_CALL.test(file.text))
      .map((file) => file.name)
    expect(offenders).toEqual([])
  })

  it('the one legitimate call site actually calls the RPC, so this guard cannot pass by nobody calling it at all', () => {
    const caller = sourceFiles.find((file) => file.name === REGENERATION_CALL_SITE)
    expect(REGENERATE_RPC_CALL.test(caller?.text ?? '')).toBe(true)
  })
})
