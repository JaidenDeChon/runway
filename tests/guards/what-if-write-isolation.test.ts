/**
 * Structural half of issue #16's central promise: **a what-if preview never
 * reaches storage of any kind unless the user promotes it.**
 *
 * The behavioural half is elsewhere — `app/lib/what-if.test.ts` covers the
 * layering, `tests/integration/what-if-write-isolation.test.ts` runs the real
 * preview pipeline against a live database and shows every row unmoved, and
 * the E2E specs drive the mode through the browser. None of those can prove a
 * *negative* about code that was not run, though: a test suite proves that
 * what it exercised wrote nothing, never that no path exists. That is what
 * this file is for, and it is why it reads source text rather than behaviour,
 * the same shape as `occurrence-write-sites.test.ts` and
 * `tests/domain/purity.test.ts`.
 *
 * Three rules, each chosen because breaking it is the realistic way this
 * guarantee would be lost:
 *
 * 1. **`app/lib/what-if.ts` cannot write.** The module that holds scratch
 *    state imports no client, no fetch and no storage API, so there is
 *    nothing in scope for a future line to call. This is the strongest of the
 *    three: it is a fact about what the file can reach, not about what it
 *    currently does.
 * 2. **The preview branch calls no mutation.** `previewOccurrenceEdit` in
 *    `app/pages/index.vue` is the one function a what-if edit flows through,
 *    and none of the `useRunwayData()` seam's writers may appear in it.
 * 3. **Web storage under `app/` has exactly one owner.** The issue asks that
 *    scratch state must not persist anywhere it could be mistaken for real
 *    data on return, and CLAUDE.md is blunter still: anything reaching for
 *    `localStorage` to hold user data should be a Supabase call. A rule
 *    naming only what-if would be unenforceable — a future refactor could
 *    route the list through any file — so the rule is the broad one, with
 *    `useChartDensity.ts` named as the single deliberate exception it already
 *    is (a device preference, not user data; see CLAUDE.md on the
 *    distinction, and issue #72 on moving it).
 *
 * Every rule is paired with a positive assertion, because the failure mode of
 * a guard like this is passing vacuously: a renamed function or a glob that
 * matches nothing must turn this red, not quiet.
 *
 * No database, no Nuxt boot, no Vue — it opens files and reads them.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url))

interface SourceFile {
  /** Path relative to `app/`, so a failure names `lib/what-if.ts`, not the absolute path. */
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

const SCRATCH_MODULE = 'lib/what-if.ts'
const DASHBOARD_PAGE = 'pages/index.vue'
const SEAM_FILE = 'composables/useRunwayData.ts'
/** The one file under `app/` allowed to touch web storage. A device preference, not user data. */
const STORAGE_OWNER = 'composables/useChartDensity.ts'

function sourceOf(name: string): string {
  const file = sourceFiles.find((candidate) => candidate.name === name)
  if (!file) throw new Error(`guard cannot run: app/${name} was not found`)
  return file.text
}

/**
 * Drops whole-line comments only.
 *
 * Deliberately not a real comment stripper: removing everything after a `//`
 * would also eat the tail of a line holding a URL, and a stripper that can
 * remove code is a stripper that can hide a violation. A line whose *first*
 * non-space characters open a comment is never code, which is all these rules
 * need — the legitimate `localStorage` mentions under `app/` are prose in doc
 * comments (`lib/supabase/client.ts`, `lib/shortfall-target.ts`), and each of
 * those lines begins with `*`.
 */
function codeLines(text: string): string[] {
  return text.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(line))
}

/**
 * The body of a top-level function, by name.
 *
 * Line-based rather than brace-counting on purpose: Biome formats every
 * top-level function in a `<script setup>` block at indentation zero, so the
 * body ends at the first line that is exactly `}`. Brace counting would have
 * to reason about braces inside strings; this does not, and it cannot silently
 * return a truncated body — a missing terminator throws.
 */
function functionBody(text: string, name: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`function ${name}(`))
  if (start === -1) throw new Error(`guard cannot run: no top-level function ${name}() was found`)
  const end = lines.indexOf('}', start)
  if (end === -1) throw new Error(`guard cannot run: ${name}()'s body has no closing line`)
  return lines.slice(start + 1, end).join('\n')
}

/**
 * Every name `useRunwayData()` hands back, read out of its own `return`
 * object rather than listed here, so the mutation list below is checked
 * against the seam instead of drifting from it.
 */
function seamMembers(): Set<string> {
  const seam = sourceOf(SEAM_FILE)
  const open = seam.lastIndexOf('\n  return {\n')
  if (open === -1) throw new Error(`guard cannot run: no return object found in ${SEAM_FILE}`)
  const close = seam.indexOf('\n  }', open + 1)
  if (close === -1)
    throw new Error(`guard cannot run: ${SEAM_FILE}'s return object is unterminated`)
  const names = seam
    .slice(open, close)
    .split('\n')
    .flatMap((line) => /^\s{4}([A-Za-z_$][\w$]*)\s*[,:]/.exec(line)?.[1] ?? [])
  return new Set(names)
}

/** The writers on the seam. A preview must not name any of them. */
const MUTATIONS = [
  'saveAccount',
  'saveBalances',
  'archiveAccount',
  'restoreAccount',
  'saveRecurringItem',
  'removeRecurringItem',
  'regenerateOccurrences',
  'overrideOccurrence',
  'revertOccurrence',
  'splitRecurringItem',
  'addTransfer',
  'setSafetyCushion',
  'setTimeZoneOverride',
  'setMonthlyDiscretionarySpend',
  'setDefaultHorizonDays',
  'setAccountHidden',
  'clearRecords',
] as const

/** Anything that could reach a server or a disk without going through the seam. */
const ESCAPE_HATCHES: Record<string, RegExp> = {
  'the Supabase client': /useSupabaseClient|createBrowserClient|serverSupabaseClient/,
  'a Supabase table': /\.from\(/,
  'a Supabase RPC': /\.rpc\(/,
  'the data seam': /useRunwayData/,
  'an HTTP call': /\$fetch|useFetch|useAsyncData|\bfetch\(/,
  'web storage': /localStorage|sessionStorage|indexedDB/,
  'a cookie': /document\.cookie|useCookie/,
}

const WEB_STORAGE = /\b(localStorage|sessionStorage|indexedDB)\b/

describe('what-if scratch state cannot reach storage', () => {
  it('found the files it reasons about, so a silent glob failure cannot pass', () => {
    expect(sourceFiles.length).toBeGreaterThan(20)
    const names = sourceFiles.map((file) => file.name)
    expect(names).toContain(SCRATCH_MODULE)
    expect(names).toContain(DASHBOARD_PAGE)
    expect(names).toContain(SEAM_FILE)
    expect(names).toContain(STORAGE_OWNER)
  })

  describe(`app/${SCRATCH_MODULE} has nothing in scope that could write`, () => {
    for (const [what, pattern] of Object.entries(ESCAPE_HATCHES)) {
      it(`never reaches for ${what}`, () => {
        expect(codeLines(sourceOf(SCRATCH_MODULE)).filter((line) => pattern.test(line))).toEqual([])
      })
    }

    it('imports only the domain and its sibling payload types', () => {
      const imports = codeLines(sourceOf(SCRATCH_MODULE))
        .flatMap((line) => /from '([^']+)'/.exec(line)?.[1] ?? [])
        .filter((specifier) => !specifier.startsWith('~~/domain/'))
      expect(imports).toEqual(['./occurrence-editor'])
    })

    it('still exports the scratch API the page uses, so this cannot pass by the module being empty', () => {
      const text = sourceOf(SCRATCH_MODULE)
      for (const symbol of ['withScratchEdit', 'hasScratchEdits', 'overridesInEffect']) {
        expect(text).toContain(`export function ${symbol}`)
      }
    })
  })

  describe(`the preview branch in app/${DASHBOARD_PAGE} calls no mutation`, () => {
    it('names every mutation this guard bans as one the seam actually returns', () => {
      // Without this, renaming `overrideOccurrence` on the seam would leave a
      // ban on a name nothing can call any more — green, and proving nothing.
      const members = seamMembers()
      expect([...MUTATIONS].filter((name) => !members.has(name))).toEqual([])
    })

    it('routes previews through previewOccurrenceEdit, which still does the layering', () => {
      // The positive half: the function exists, and it is the one holding the
      // scratch write. A guard on an empty or deleted function is vacuous.
      expect(functionBody(sourceOf(DASHBOARD_PAGE), 'previewOccurrenceEdit')).toContain(
        'withScratchEdit',
      )
    })

    for (const mutation of MUTATIONS) {
      it(`does not call ${mutation}()`, () => {
        const body = functionBody(sourceOf(DASHBOARD_PAGE), 'previewOccurrenceEdit')
        expect(codeLines(body).filter((line) => line.includes(mutation))).toEqual([])
      })
    }

    for (const [what, pattern] of Object.entries(ESCAPE_HATCHES)) {
      it(`does not reach around the seam for ${what}`, () => {
        const body = functionBody(sourceOf(DASHBOARD_PAGE), 'previewOccurrenceEdit')
        expect(codeLines(body).filter((line) => pattern.test(line))).toEqual([])
      })
    }
  })

  describe('web storage under app/ has exactly one owner', () => {
    it(`is used by app/${STORAGE_OWNER} and by nothing else`, () => {
      const offenders = sourceFiles
        .filter((file) => file.name !== STORAGE_OWNER)
        .filter((file) => codeLines(file.text).some((line) => WEB_STORAGE.test(line)))
        .map((file) => file.name)
      expect(offenders).toEqual([])
    })

    it(`app/${STORAGE_OWNER} really does use it, so the exception is not stale`, () => {
      expect(codeLines(sourceOf(STORAGE_OWNER)).some((line) => WEB_STORAGE.test(line))).toBe(true)
    })

    it('has no user data in scope to store there, only a device preference', () => {
      // The exception is scoped by what the file can see, not by what it
      // happens to write today: a module that imports neither the domain nor
      // the data seam has no override, balance or amount to persist. Chart
      // density is a fact about the screen you are looking at, which is why
      // it is allowed to live on the device at all (CLAUDE.md).
      const imports = codeLines(sourceOf(STORAGE_OWNER)).flatMap(
        (line) => /from '([^']+)'/.exec(line)?.[1] ?? [],
      )
      const userData = imports.filter(
        (specifier) =>
          specifier.startsWith('~~/domain/') || /useRunwayData|what-if/.test(specifier),
      )
      expect(userData).toEqual([])
    })
  })
})
