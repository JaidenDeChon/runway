/**
 * Bundle-size measurement for issue #10's chart-library bake-off.
 *
 *     bun scripts/bakeoff-bundle.ts
 *
 * N+1 real builds — a baseline (`RUNWAY_LAB=0`) plus one per candidate slug
 * (`RUNWAY_LAB=<slug>`) — because it is the only method that answers "what
 * does adding this cost" without guessing at shared-chunk attribution. Each
 * build sums every `.js` and `.css` file under `.output/public/_nuxt/`
 * (client output only — a mobile user downloads that, never the server
 * bundle), raw and gzipped (`zlib.gzipSync`). `.map` files are excluded: a
 * browser only fetches them with devtools open, so they are not part of a
 * normal page load's weight.
 *
 * A failed build is a headline finding (see the write-up's F3 on
 * `@unovis/ts`'s `three`/`elkjs` dependencies), never a recorded zero — this
 * script throws rather than swallowing a build failure into a silent 0.
 *
 * Slow — six builds if candidate E ever gets built too — and that is fine;
 * it is the honest number. Candidate slugs are discovered from
 * `app/pages/lab/chart-bakeoff/<slug>.vue` existing on disk, so this script
 * needs no edit when a candidate is added or (per P8) removed.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const ROOT = new URL('../', import.meta.url).pathname
const OUTPUT_PUBLIC_NUXT = join(ROOT, '.output/public/_nuxt')
const PAGES_DIR = join(ROOT, 'app/pages/lab/chart-bakeoff')
const RESULTS_PATH = join(ROOT, '.claude/runway-runner/tasks/10/bundle-sizes.json')

const MEASURED_EXTENSIONS = ['.js', '.css']

interface BundleSize {
  readonly rawBytes: number
  readonly gzipBytes: number
  readonly fileCount: number
}

interface CandidateResult extends BundleSize {
  readonly slug: string
  readonly rawDelta: number
  readonly gzipDelta: number
  /** Secondary, clearly-labelled — NOT the shipped cost. Sum of this candidate's own top-level packages in node_modules. */
  readonly nodeModulesBytes: number
}

/** Slugs discovered from the candidate pages that actually exist — see the module comment. */
function discoverCandidateSlugs(): string[] {
  return readdirSync(PAGES_DIR)
    .filter((file) => file.endsWith('.vue') && file !== 'index.vue')
    .map((file) => file.replace(/\.vue$/, ''))
    .sort()
}

/** Each candidate's own top-level packages, read from candidates.ts's own data — one source of truth. */
async function candidatePackageNames(slug: string): Promise<string[]> {
  const mod = await import('../app/lab/chart-bakeoff/candidates')
  const candidate = mod.CANDIDATES.find((entry) => entry.slug === slug)
  return candidate ? candidate.packages.map((pkg) => pkg.name) : []
}

function directoryBytes(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += directoryBytes(full)
    else if (entry.isFile()) total += statSync(full).size
  }
  return total
}

function nodeModulesBytesFor(packageNames: readonly string[]): number {
  return packageNames.reduce(
    (sum, name) => sum + directoryBytes(join(ROOT, 'node_modules', name)),
    0,
  )
}

function measureClientBundle(): BundleSize {
  let rawBytes = 0
  let gzipBytes = 0
  let fileCount = 0

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!MEASURED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue
      const contents = readFileSync(full)
      rawBytes += contents.byteLength
      gzipBytes += gzipSync(contents).byteLength
      fileCount += 1
    }
  }

  if (!existsSync(OUTPUT_PUBLIC_NUXT)) {
    throw new Error(`Build did not produce ${OUTPUT_PUBLIC_NUXT} — see the build output above.`)
  }
  walk(OUTPUT_PUBLIC_NUXT)
  return { rawBytes, gzipBytes, fileCount }
}

/**
 * Runs `bun run build` with `RUNWAY_LAB` set, and throws — loudly, with the
 * build's own output already on stderr — if it fails. A failed build must
 * never be recorded as a zero; that reads as "costs nothing," the exact
 * inversion of the truth (see `@unovis/ts`'s heavy transitive dependencies).
 */
function build(runwayLab: string): void {
  process.stdout.write(`\n=== bun run build (RUNWAY_LAB=${runwayLab || '(unset)'}) ===\n`)
  execFileSync('bun', ['run', 'build'], {
    cwd: ROOT,
    env: { ...process.env, RUNWAY_LAB: runwayLab },
    stdio: 'inherit',
  })
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`
}

function formatDelta(bytes: number): string {
  const kb = bytes / 1024
  const sign = kb >= 0 ? '+' : ''
  return `${sign}${kb.toFixed(1)} kB`
}

async function main(): Promise<void> {
  const slugs = discoverCandidateSlugs()
  process.stdout.write(`Candidates discovered: ${slugs.join(', ')}\n`)

  build('0')
  const baseline = measureClientBundle()
  process.stdout.write(
    `Baseline: ${formatKb(baseline.rawBytes)} raw / ${formatKb(baseline.gzipBytes)} gzip (${baseline.fileCount} files)\n`,
  )

  const results: CandidateResult[] = []
  for (const slug of slugs) {
    build(slug)
    const measured = measureClientBundle()
    const packageNames = await candidatePackageNames(slug)
    results.push({
      slug,
      ...measured,
      rawDelta: measured.rawBytes - baseline.rawBytes,
      gzipDelta: measured.gzipBytes - baseline.gzipBytes,
      nodeModulesBytes: nodeModulesBytesFor(packageNames),
    })
  }

  // Leave the working tree in the production shape, not mid-candidate.
  build('0')

  mkdirSync(join(ROOT, '.claude/runway-runner/tasks/10'), { recursive: true })
  writeFileSync(
    RESULTS_PATH,
    `${JSON.stringify({ measuredAt: new Date().toISOString(), baseline, candidates: results }, null, 2)}\n`,
  )
  process.stdout.write(`\nRaw numbers written to ${RESULTS_PATH}\n\n`)

  const rows = [
    '| Candidate | Raw (client) | Raw delta | Gzip (client) | Gzip delta | node_modules (own packages, secondary) |',
    '|---|---|---|---|---|---|',
    `| _baseline_ (RUNWAY_LAB=0) | ${formatKb(baseline.rawBytes)} | — | ${formatKb(baseline.gzipBytes)} | — | — |`,
    ...results.map(
      (r) =>
        `| ${r.slug} | ${formatKb(r.rawBytes)} | ${formatDelta(r.rawDelta)} | ${formatKb(r.gzipBytes)} | ${formatDelta(r.gzipDelta)} | ${formatKb(r.nodeModulesBytes)} |`,
    ),
  ]
  process.stdout.write(`${rows.join('\n')}\n`)
}

await main()
