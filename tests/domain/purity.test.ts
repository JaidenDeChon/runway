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
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DOMAIN_DIR = fileURLToPath(new URL('../../domain/', import.meta.url))

const sourceFiles = readdirSync(DOMAIN_DIR)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, text: readFileSync(join(DOMAIN_DIR, name), 'utf8') }))

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

describe('the projection engine is a pure module', () => {
  it('has source files to check, so a silent glob failure cannot pass', () => {
    expect(sourceFiles.length).toBeGreaterThan(8)
    expect(sourceFiles.map((file) => file.name)).toContain('projection.ts')
  })

  it.each(sourceFiles.map((file) => file.name))('%s imports nothing outside domain/', (name) => {
    const file = sourceFiles.find((candidate) => candidate.name === name)
    for (const specifier of importedModules(file?.text ?? '')) {
      // Relative sibling imports are the only kind the domain is allowed.
      expect(specifier.startsWith('./')).toBe(true)
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(specifier.startsWith(forbidden)).toBe(false)
      }
    }
  })

  it.each(sourceFiles.map((file) => file.name))('%s never reads the clock', (name) => {
    const file = sourceFiles.find((candidate) => candidate.name === name)
    const text = file?.text ?? ''
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
    const file = sourceFiles.find((candidate) => candidate.name === name)
    expect(file?.text ?? '').not.toMatch(/\bconsole\.\w+\(/)
  })
})
