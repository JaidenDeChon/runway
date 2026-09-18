/**
 * `<NuxtRouteAnnouncer>` in `app/app.vue` mounts a visually-hidden
 * `<span role="status" aria-live="polite">` on **every** route, holding the
 * document title. It is real accessibility infrastructure and stays — but it
 * means a page-wide `page.getByRole('status')` in an E2E spec matches the
 * announcer, not the thing the test meant to read.
 *
 * That is not a hypothetical. Issue #84 was filed as a flaky
 * `strict mode violation: resolved to 2 elements` in the password-reset
 * enumeration test. The flake was the *honest* outcome: on every other run the
 * locator quietly resolved to the announcer alone, so the test compared the
 * page title with itself and would have passed whatever the two
 * acknowledgements said. A security property CLAUDE.md calls absolute was
 * unverified for as long as the test was green.
 *
 * So: an E2E spec may query `status` only through a scoping locator
 * (`something.getByRole('status')`), never off `page`. Scope first, and the
 * announcer is out of reach by construction.
 *
 * `role="alert"` is deliberately not guarded. The announcer only takes that
 * role under `politeness: 'assertive'`, which nothing in this app sets — add
 * it here if that ever changes.
 *
 * No browser, no app, no stack: it opens the spec files and reads them, the
 * same shape as `tests/guards/occurrence-write-sites.test.ts`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const E2E_DIR = fileURLToPath(new URL('../e2e/', import.meta.url))

interface SpecFile {
  /** Path relative to `tests/e2e/`, so a failure names `authentication.spec.ts`. */
  readonly name: string
  readonly text: string
}

function collectSpecFiles(dir: string): SpecFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collectSpecFiles(path)
    if (!entry.name.endsWith('.ts')) return []
    return [{ name: relative(E2E_DIR, path), text: readFileSync(path, 'utf8') }]
  })
}

const specFiles = collectSpecFiles(E2E_DIR)

/**
 * `page.getByRole('status')` / `page.getByRole("status")`, with any whitespace
 * the formatter might introduce. A scoped call reads
 * `someLocator.getByRole('status')` and is what this deliberately does not
 * match — the receiver being `page` is the whole defect.
 */
const UNSCOPED_STATUS_QUERY = /\bpage\s*\.\s*getByRole\(\s*['"]status['"]/

describe('E2E specs and the route announcer', () => {
  it('finds spec files to check', () => {
    // A broken glob would make every assertion below vacuously true, which is
    // the same failure this guard exists to catch.
    expect(specFiles.length).toBeGreaterThan(0)
  })

  it('never queries role="status" off `page`, which would match the announcer', () => {
    const offenders = specFiles
      .filter((file) => UNSCOPED_STATUS_QUERY.test(file.text))
      .map((file) => file.name)

    expect(
      offenders,
      "scope the query to the surface under test — `page.locator('[data-slot=\"card\"]').getByRole('status')` — " +
        'because <NuxtRouteAnnouncer> puts a role="status" span on every page',
    ).toEqual([])
  })
})
