/**
 * The domain's purity, enforced rather than promised.
 *
 * Issue #4's first functional requirement is that the engine imports nothing
 * from Nuxt, Supabase, or any I/O library, and its second is that `today` is a
 * parameter and never the system clock. Both are the kind of rule that holds
 * right up until the afternoon somebody needs a timestamp — so this reads the
 * source and checks.
 *
 * It lives under `tests/` rather than in `domain/` because it has to open
 * files, and `domain/**` is lint-banned from importing `node:*` — a test that
 * had to violate the rule to check the rule would be no proof at all.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DOMAIN_DIR = fileURLToPath(new URL('../../domain/', import.meta.url))

interface SourceFile {
  /** Path relative to `domain/`, so a failure names `fixtures/scenarios.ts`, not `scenarios.ts`. */
  readonly name: string
  readonly path: string
  readonly text: string
}

/**
 * Every non-test `.ts` file under `domain/`, **at any depth**.
 *
 * The recursion is the point. This scan used to stop at the top level, which
 * left `domain/fixtures/` — domain code, imported by the golden test — outside
 * every check below. Biome's `domain/**` import ban did still cover it, so
 * nothing was actually wrong; but two of the three rules here (never read the
 * clock, never log) have no lint equivalent at all, and a whole subdirectory
 * was quietly exempt from both.
 */
function collectSourceFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [{ name: relative(DOMAIN_DIR, path), path, text: readFileSync(path, 'utf8') }]
  })
}

const sourceFiles = collectSourceFiles(DOMAIN_DIR)

const fileNamed = (name: string): SourceFile | undefined =>
  sourceFiles.find((candidate) => candidate.name === name)

/** The import prefixes `domain/README.md` forbids, and Biome enforces. */
const FORBIDDEN_IMPORTS = [
  'nuxt',
  '#app',
  '#imports',
  '#shared/',
  'vue',
  'vue-router',
  '@vue/',
  '@lucide/',
  '@supabase/',
  'node:',
  '~/',
  '@/',
  '~~/',
]

const importedModules = (text: string): string[] =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s+'([^']+)'/g)].map(
    (match) => match[1] ?? '',
  )

/** Where a relative specifier actually lands, so `../../app/thing` is caught as the escape it is. */
const resolvesInsideDomain = (file: SourceFile, specifier: string): boolean =>
  !relative(DOMAIN_DIR, resolve(dirname(file.path), specifier)).startsWith('..')

describe('the projection engine is a pure module', () => {
  it('has source files to check, so a silent glob failure cannot pass', () => {
    expect(sourceFiles.length).toBeGreaterThan(8)
    expect(sourceFiles.map((file) => file.name)).toContain('projection.ts')
  })

  it('reaches into subdirectories, so a nested file cannot sit outside these rules', () => {
    // Named rather than counted: `fixtures/scenarios.ts` is the file that was
    // outside this scan, and this fails the day the recursion is undone.
    expect(sourceFiles.map((file) => file.name)).toContain(join('fixtures', 'scenarios.ts'))
  })

  it.each(sourceFiles.map((file) => file.name))('%s imports nothing outside domain/', (name) => {
    const file = fileNamed(name)
    for (const specifier of importedModules(file?.text ?? '')) {
      // Relative imports are the only kind the domain is allowed, and only
      // while they stay inside it — `domain/fixtures/` legitimately reaches its
      // parent with `../types`, and `../../app/anything` is the leak.
      expect(specifier.startsWith('.')).toBe(true)
      expect(file && resolvesInsideDomain(file, specifier)).toBe(true)
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(specifier.startsWith(forbidden)).toBe(false)
      }
    }
  })

  it.each(sourceFiles.map((file) => file.name))('%s never reads the clock', (name) => {
    const text = fileNamed(name)?.text ?? ''
    // `Date.UTC(...)` and `new Date(millis)` are pure conversions and stay.
    // `Date.now()` and an argument-less `new Date()` are readings of *now*, and
    // one of those anywhere in here makes a projection irreproducible.
    expect(text).not.toContain('Date.now(')
    expect(text).not.toMatch(/new Date\(\s*\)/)
    expect(text).not.toContain('performance.now(')
  })

  it.each(sourceFiles.map((file) => file.name))('%s logs nothing', (name) => {
    // Balances must never reach application logs. The engine's answer is its
    // return value; it has nothing to say on the side.
    expect(fileNamed(name)?.text ?? '').not.toMatch(/\bconsole\.\w+\(/)
  })
})
