/**
 * Queue, ledger and detail guard for the copy-humanizer agent
 * (`.claude/agents/copy-humanizer.md`).
 *
 * The agent rewrites the words in one file at a time with the vendored
 * humanizer skill. This script picks the file, checks that the rewrite kept
 * every detail and changed nothing but words, and records the file as done.
 *
 *     bun scripts/humanize-copy.ts next            # next file in the UI sweep
 *     bun scripts/humanize-copy.ts status          # counts: done, never done, changed since
 *     bun scripts/humanize-copy.ts next --docs     # next file in the docs sweep
 *     bun scripts/humanize-copy.ts status --docs
 *     bun scripts/humanize-copy.ts check PATH      # compare PATH with its HEAD version
 *     bun scripts/humanize-copy.ts record PATH     # mark PATH as humanized
 *
 * Paths are relative to the repo root, e.g. `app/components/shortfall/VerdictCard.vue`.
 *
 * Two sweeps. The UI sweep (the default) covers the words a Runway user sees:
 * the Vue components, pages and layouts, and the few TypeScript helpers that
 * hold copy. It runs screen by screen in the order a new user meets them, and
 * within a screen the components that name the controls come before the
 * helpers and pages whose hints refer to those controls. The docs sweep
 * (`--docs`) covers the Markdown a developer reads: the README and `docs/`.
 * Design specs, agent rules, vendored code, generated files, tests,
 * migrations and fixtures are never offered (`neverReason`). The security
 * copy in `SECURITY_COPY` is never offered either; it is checked only when a
 * person names it.
 *
 * For a `.vue` or `.ts` file, `check` masks every piece of copy (template
 * text, static text attributes such as `aria-label`, and string literals that
 * read as words) and fails if anything else changed: code, class lists, ids,
 * keys, comments, `{{ }}` and `${}` expressions, `<style>`. It also fails when
 * a number in the copy was lost or added, or when a string that a design spec
 * fixes verbatim was changed, and it warns about tests and docs that still
 * quote the old wording.
 *
 * For a Markdown file, `check` fails when frontmatter, headings, code, HTML
 * comments, table structure, links, inline code, numbers or quotations
 * changed, and warns about italic spans, capitalised words and rule words
 * (must, never, always...) that are gone.
 *
 * `check` exits 1 on any ERROR. Warnings alone exit 0 and are for the agent to
 * review by hand.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const LEDGER_PATH = '.claude/humanized-copy.json'

export type Sweep = 'ui' | 'docs'

// ------------------------------------------------------------------ queue ---

/**
 * The UI sweep, in order. Shell and shared controls first, because every
 * screen refers to them; then each screen in the order a new user meets it,
 * with the components that name the controls ahead of the helpers and the
 * page whose hints mention them. A `.vue` file under `app/` that is not
 * listed here is still swept, after these, alphabetically.
 */
export const UI_ORDER: readonly string[] = [
  // The shell: navigation, sidebar, header and the controls in it.
  'app/lib/navigation.ts',
  'app/components/AppSidebar.vue',
  'app/components/AppUserMenu.vue',
  'app/components/AppThemeToggle.vue',
  'app/components/AppWhatIfToggle.vue',
  'app/layouts/default.vue',
  'app/components/AppPage.vue',
  'app/components/ResponsiveEditor.vue',
  'app/components/MoneyInput.vue',
  'app/components/MoneyText.vue',
  'app/components/AccountColorPicker.vue',
  'app/components/AccountSwatch.vue',
  'app/lib/account-colors.ts',
  'app/app.vue',
  // Signing in. The messages about the outcome come from shared/auth/errors.ts,
  // which is security copy and not in this sweep.
  'app/layouts/auth.vue',
  'app/components/auth/AuthCard.vue',
  'app/components/auth/AuthMessage.vue',
  'app/pages/sign-in.vue',
  'app/pages/sign-up.vue',
  'app/pages/forgot-password.vue',
  'app/pages/reset-password.vue',
  'app/pages/auth/error.vue',
  'shared/auth/session.ts',
  // First run.
  'app/layouts/onboarding.vue',
  'app/components/first-run/StepProgressDots.vue',
  'app/components/first-run/ChartPlaceholder.vue',
  'app/components/first-run/AccountStepCard.vue',
  'app/components/first-run/RecurringItemStepCard.vue',
  'app/components/first-run/DoneCard.vue',
  'app/pages/first-run.vue',
  // The dashboard.
  'app/components/dashboard/BurndownChart.vue',
  'app/components/dashboard/ChartDensityPanel.vue',
  'app/components/dashboard/AccountLegendRow.vue',
  'app/components/dashboard/BalanceForecastCard.vue',
  'app/components/dashboard/LowestBalanceCard.vue',
  'app/components/dashboard/StaleBalancesAlert.vue',
  'app/components/dashboard/UpdateBalancesEditor.vue',
  'app/components/dashboard/OccurrenceAmountRow.vue',
  'app/components/dashboard/OccurrenceRow.vue',
  'app/components/dashboard/UpcomingCard.vue',
  'app/components/dashboard/DayDetailEditor.vue',
  'app/components/dashboard/WhatIfBar.vue',
  'app/lib/occurrence-amount.ts',
  'app/lib/occurrence-editor.ts',
  'app/lib/what-if.ts',
  'app/composables/useRunwayData.ts',
  'app/pages/index.vue',
  // Will I make it?
  'app/components/shortfall/BillOptionRow.vue',
  'app/components/shortfall/StatCell.vue',
  'app/components/shortfall/AskCard.vue',
  'app/components/shortfall/VerdictCard.vue',
  'app/pages/will-i-make-it.vue',
  // Accounts.
  'app/components/accounts/AccountRow.vue',
  'app/components/accounts/AccountEditor.vue',
  'app/components/accounts/SafetyCushionCard.vue',
  'app/components/accounts/DiscretionarySpendCard.vue',
  'app/pages/accounts.vue',
  // Recurring items.
  'app/components/recurring-items/RecurringItemRow.vue',
  'app/components/recurring-items/PredictedAmountPanel.vue',
  'app/components/recurring-items/RecurringItemEditor.vue',
  'app/pages/recurring-items.vue',
  // Errors the server returns to a signed-in user.
  'server/api/user-settings.get.ts',
]

/**
 * The docs sweep, in order: what a developer reads first. Any other Markdown
 * file under `docs/` or `domain/` that is not locked comes after these.
 */
export const DOCS_ORDER: readonly string[] = [
  'README.md',
  'docs/testing.md',
  'docs/auth.md',
  'docs/database/local-development.md',
  'docs/database/rls.md',
  'docs/database/schema.md',
  'docs/engine/README.md',
  'domain/README.md',
  'domain/fixtures/README.md',
  'docs/agents.md',
]

/**
 * Copy whose wording is a security rule. `shared/auth/errors.ts` holds every
 * message a signed-out visitor sees and must never reveal whether an email
 * address is registered; the password rule is held against
 * `supabase/config.toml`; `requireUser`'s message answers every signed-out
 * request. Never in a sweep. `check` works on them only when a person names
 * one, and says so.
 */
export const SECURITY_COPY: readonly string[] = [
  'shared/auth/errors.ts',
  'shared/auth/password.ts',
  'server/utils/supabase.ts',
]

/** Why a file is never humanized, or null when it may be. */
export function neverReason(path: string): string | null {
  const p = path.split(sep).join('/')
  if (/\.(test|spec)\.ts$/.test(p) || p.startsWith('tests/')) {
    return 'tests are not copy; a test that asserts wording is updated along with the string it asserts'
  }
  if (p.startsWith('app/components/ui/')) {
    return 'vendored shadcn-vue code, regenerated by `bun run ui:add`'
  }
  if (p.startsWith('app/lab/') || p.startsWith('app/pages/lab/')) {
    return 'the chart bake-off lab, not a product screen'
  }
  if (p.startsWith('docs/design/')) {
    return 'design specs are authoritative for UI copy; changing one is a design decision for a person'
  }
  if (p === 'CLAUDE.md' || p === 'AGENTS.md') {
    return 'agent rules, kept identical to each other by hand; edit them on purpose, not in a sweep'
  }
  if (p.startsWith('.claude/') || p.startsWith('.agents/') || p.startsWith('.github/')) {
    return 'agent definitions, vendored skills and repository configuration'
  }
  if (p.startsWith('supabase/')) return 'migrations, database config and the synthetic seed'
  if (p.startsWith('shared/supabase/')) return 'generated database types and connection config'
  if (p.startsWith('domain/') && !p.endsWith('.md')) {
    return 'the projection engine; its strings are errors for developers and fixture data'
  }
  if (p === 'app/lib/format.ts') return 'money and date formatting; format strings are code'
  if (p === 'bun.lock' || p.endsWith('.json')) return 'lockfiles and configuration'
  return null
}

function walk(root: string, dir: string, keep: (rel: string) => boolean): string[] {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  const found: string[] = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    if (entry.isDirectory()) found.push(...walk(root, rel, keep))
    else if (entry.isFile() && keep(rel)) found.push(rel)
  }
  return found
}

/** Every file in a sweep, in sweep order. Only files that exist are listed. */
export function sweepItems(sweep: Sweep, root: string = ROOT): string[] {
  const order = sweep === 'ui' ? UI_ORDER : DOCS_ORDER
  const listed = order.filter((p) => existsSync(join(root, p)))
  const extra =
    sweep === 'ui'
      ? walk(root, 'app', (p) => p.endsWith('.vue'))
      : [
          ...walk(root, 'docs', (p) => p.endsWith('.md')),
          ...walk(root, 'domain', (p) => p.endsWith('.md')),
        ]
  const rest = extra
    .filter((p) => !order.includes(p) && neverReason(p) === null && !SECURITY_COPY.includes(p))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  return [...listed, ...rest]
}

interface LedgerEntry {
  readonly humanizedAt: string
  readonly sha256: string
}

type Ledger = Record<string, LedgerEntry>

export function loadLedger(root: string = ROOT): Ledger {
  const path = join(root, LEDGER_PATH)
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as Ledger
}

export function fileSha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export interface Classified {
  readonly fresh: string[]
  readonly stale: string[]
  readonly done: string[]
}

/** Split a sweep into (never humanized, changed since humanized, done and unchanged). */
export function classify(sweep: Sweep, root: string = ROOT): Classified {
  const ledger = loadLedger(root)
  const result: Classified = { fresh: [], stale: [], done: [] }
  for (const item of sweepItems(sweep, root)) {
    const entry = ledger[item]
    if (!entry) result.fresh.push(item)
    else if (entry.sha256 !== fileSha(join(root, item))) result.stale.push(item)
    else result.done.push(item)
  }
  return result
}

export function recordItem(path: string, root: string = ROOT, now: Date = new Date()): void {
  const ledger = loadLedger(root)
  ledger[path] = {
    humanizedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    sha256: fileSha(join(root, path)),
  }
  const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(root, LEDGER_PATH), `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
}

// ---------------------------------------------------------- shared helpers ---

export interface CheckResult {
  readonly errors: string[]
  readonly warnings: string[]
}

type Bag = Map<string, number>

function bag(items: Iterable<string>): Bag {
  const counts: Bag = new Map()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

/** What `a` has more of than `b`. */
function minus(a: Bag, b: Bag): Bag {
  const out: Bag = new Map()
  for (const [key, count] of a) {
    const left = count - (b.get(key) ?? 0)
    if (left > 0) out.set(key, left)
  }
  return out
}

function show(counts: Bag): string {
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => JSON.stringify(key) + (count > 1 ? ` x${count}` : ''))
    .join(', ')
}

const NUMBER_RE = /(?<![\w.])\d[\d,]*(?:\.\d+)?/g

function numbersIn(text: string): string[] {
  return (text.match(NUMBER_RE) ?? []).map((n) => n.replace(/,/g, ''))
}

function allMatches(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => m.slice(1).find((g) => g !== undefined) ?? m[0])
}

// --------------------------------------------------------------- Markdown ---

export interface MarkdownParts {
  readonly frontmatter: string
  readonly locked: string[]
  readonly prose: string
}

/**
 * Split a Markdown file into (frontmatter, locked lines, editable prose).
 *
 * Locked lines must survive byte for byte and in order: headings (other docs
 * link to them by anchor), fenced code, horizontal rules, HTML comments,
 * reference-link definitions, and each table row's shape (its pipes, so a
 * table keeps its columns). Table cells are prose.
 */
export function splitMarkdown(text: string): MarkdownParts {
  let body = text
  let frontmatter = ''
  const fm = /^---\n[\s\S]*?\n---\n/.exec(body)
  if (fm) {
    frontmatter = fm[0]
    body = body.slice(fm[0].length)
  }

  const locked: string[] = []
  const prose: string[] = []
  let fence: string | null = null
  let inComment = false
  for (const line of body.split('\n')) {
    const stripped = line.trim()
    const fenceMark = /^(`{3,}|~{3,})/.exec(stripped)?.[1]
    if (fence !== null) {
      locked.push(line)
      if (fenceMark?.startsWith(fence)) fence = null
      continue
    }
    if (fenceMark) {
      fence = fenceMark
      locked.push(line)
      continue
    }
    if (inComment || stripped.startsWith('<!--')) {
      locked.push(line)
      inComment = !stripped.includes('-->')
      continue
    }
    if (/^#{1,6}\s/.test(stripped) || /^(?:-{3,}|\*{3,}|_{3,})$/.test(stripped)) {
      locked.push(line)
      continue
    }
    if (/^\[[^\]]+\]:\s*\S/.test(stripped)) {
      locked.push(line)
      continue
    }
    if (stripped.startsWith('|')) {
      // Escaped pipes and pipes inside inline code are cell content.
      const shape = stripped.replace(/`[^`]*`/g, '').replace(/\\\|/g, '')
      if (/^\|?[\s:|-]+\|?$/.test(shape)) {
        locked.push(line)
      } else {
        locked.push(shape.replace(/[^|]/g, ''))
        prose.push(line)
      }
      continue
    }
    prose.push(line)
  }
  return { frontmatter, locked, prose: prose.join('\n') }
}

const INLINE_CODE_RE = /`([^`\n]+)`/g
const LINK_RE =
  /\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(?<![(<])(https?:\/\/[^\s)>]+)/g
const QUOTE_RE = /"([^"\n]{3,})"|“([^”\n]{3,})”/g
const ITALIC_RE = /(?<![*\w])\*([^*\n]+)\*(?![*\w])|(?<!\w)_([^_\n]+)_(?!\w)/g
// Capitalised words mid-sentence: likely names, products and titles. Words
// that open a sentence are skipped because rewording moves them freely.
const CAP_RE = /(?<=[\w,;:)\]] )[A-Z][A-Za-z0-9'’.-]*[A-Za-z0-9]\b/g
// Words that make a sentence a rule. Losing one can turn "must" into "may".
const RULE_WORD_RE = /\b(must|never|always|only|required|forbidden|cannot|do not|don't)\b/gi

function markdownFacts(prose: string): Record<string, Bag> {
  const code = allMatches(INLINE_CODE_RE, prose)
  const noCode = prose.replace(INLINE_CODE_RE, ' ')
  const links = allMatches(LINK_RE, noCode)
  const bare = noCode.replace(LINK_RE, ' ')
  return {
    'inline code': bag(code),
    links: bag(links),
    numbers: bag(numbersIn(bare)),
    quotes: bag(allMatches(QUOTE_RE, noCode)),
    italics: bag(allMatches(ITALIC_RE, noCode)),
    capitalised: bag(bare.match(CAP_RE) ?? []),
    'rule words': bag((bare.match(RULE_WORD_RE) ?? []).map((w) => w.toLowerCase())),
  }
}

export function checkMarkdown(before: string, after: string): CheckResult {
  const a = splitMarkdown(before)
  const b = splitMarkdown(after)
  const errors: string[] = []
  const warnings: string[] = []

  if (a.frontmatter !== b.frontmatter)
    errors.push('frontmatter changed; it must stay byte for byte')
  if (a.locked.join('\n') !== b.locked.join('\n')) {
    const lost = a.locked.filter((l) => !b.locked.includes(l)).slice(0, 10)
    const added = b.locked.filter((l) => !a.locked.includes(l)).slice(0, 10)
    const detail = [...lost.map((l) => `\n    - ${l}`), ...added.map((l) => `\n    + ${l}`)].join(
      '',
    )
    errors.push(
      'headings, code blocks, HTML comments, rules, link definitions or table shape changed ' +
        '(only prose and table cells may change):' +
        (detail || ' order differs'),
    )
  }

  const fa = markdownFacts(a.prose)
  const fb = markdownFacts(b.prose)
  for (const kind of ['inline code', 'links', 'numbers', 'quotes'] as const) {
    const lost = minus(fa[kind] ?? new Map(), fb[kind] ?? new Map())
    const gained = minus(fb[kind] ?? new Map(), fa[kind] ?? new Map())
    if (lost.size) errors.push(`${kind} lost: ${show(lost)}`)
    if (gained.size) errors.push(`${kind} added: ${show(gained)}`)
  }
  const lowerAfter = b.prose.toLowerCase()
  for (const kind of ['italics', 'capitalised'] as const) {
    // A word may survive in a new position or case, so warn only when it is
    // gone entirely. Review, not failure.
    const lost = minus(fa[kind] ?? new Map(), fb[kind] ?? new Map())
    for (const key of [...lost.keys()]) if (lowerAfter.includes(key.toLowerCase())) lost.delete(key)
    if (lost.size) warnings.push(`${kind} no longer present: ${show(lost)}`)
  }
  const rulesLost = minus(fa['rule words'] ?? new Map(), fb['rule words'] ?? new Map())
  if (rulesLost.size) {
    warnings.push(
      `fewer rule words: ${show(rulesLost)}; confirm every rule is still stated as strongly`,
    )
  }
  return { errors, warnings }
}

// ------------------------------------------------------------------- code ---

/** Single capitalised words that are code, not copy: keys, events, HTTP text. */
const CODE_WORDS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Home',
  'End',
  'Space',
  'Backspace',
  'Delete',
  'PageUp',
  'PageDown',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'Unauthorized',
  'Forbidden',
])

/** A token that belongs to a class list, a column list, a CSS value or a path. */
function isCodeToken(token: string): boolean {
  return (
    /[-:/[\]=_#@()]/.test(token) ||
    /^\d+(?:\.\d+)?(?:ms|s|px|rem|em|%|vh|vw|deg|fr)?,?$/.test(token)
  )
}

/**
 * Whether a string literal's text reads as copy. Copy is masked; everything
 * else (ids, keys, class lists, column lists, event names, paths, SVG path
 * data) stays visible so the check catches a change to it.
 */
export function isCopy(text: string): boolean {
  const bare = text.trim()
  if (!/[A-Za-z]/.test(bare)) return false
  if (/^[MmLlHhVvCcSsQqTtAaZz\d\s.,-]+$/.test(bare) && /\d/.test(bare)) return false
  if (bare.includes('…')) return true
  const tokens = bare.split(/\s+/)
  if (tokens.length === 1) return /^[A-Z][a-z]+[.!?]?$/.test(bare) && !CODE_WORDS.has(bare)
  if (!/[A-Z]/.test(bare) && tokens.some(isCodeToken)) return false
  return true
}

/** Static attributes whose values a user sees or hears. */
export const TEXT_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'title',
  'placeholder',
  'alt',
  'label',
  'description',
  'subtitle',
  'heading',
  'text',
  'thumb-label',
])

interface Scan {
  /** The file with every piece of copy replaced by a marker. */
  readonly masked: string
  /** The copy itself, with `{}` where an expression sits. */
  readonly copy: string[]
}

/** Calls whose string arguments are for developers, not users. */
const DEVELOPER_CALL_RE = /(?:console\.\w+|(?:new\s+)?\w*Error)\(\s*$/

/**
 * Mask copy in JavaScript or TypeScript. A small scanner rather than a
 * regex, so a `${}` holding another template literal, an apostrophe in a
 * comment, or a `//` inside a string cannot throw it off.
 */
function scanScript(src: string, copy: string[]): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i)
      const j = end < 0 ? n : end
      out += src.slice(i, j)
      i = j
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const j = end < 0 ? n : end + 2
      out += src.slice(i, j)
      i = j
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      const body = src.slice(i + 1, j)
      const developer = DEVELOPER_CALL_RE.test(out.slice(-200))
      if (!developer && isCopy(body)) {
        copy.push(body)
        out += '§S§'
      } else {
        out += src.slice(i, j + 1)
      }
      i = j + 1
    } else if (c === '`') {
      const developer = DEVELOPER_CALL_RE.test(out.slice(-200))
      const { end, quasis, exprs } = readTemplate(src, i + 1)
      const words = quasis.join('')
      if (!developer && isCopy(words)) {
        copy.push(quasis.join('{}'))
        out += `\`${exprs.map((e) => `\${${scanScript(e, copy)}}`).join('§')}§S§\``
      } else {
        out += src.slice(i, end)
      }
      i = end
    } else {
      out += c
      i += 1
    }
  }
  return out
}

/** Read a template literal whose opening backtick is just before `start`. */
function readTemplate(
  src: string,
  start: number,
): { end: number; quasis: string[]; exprs: string[] } {
  const quasis: string[] = []
  const exprs: string[] = []
  let quasi = ''
  let i = start
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      quasi += src.slice(i, i + 2)
      i += 2
    } else if (c === '`') {
      quasis.push(quasi)
      return { end: i + 1, quasis, exprs }
    } else if (c === '$' && src[i + 1] === '{') {
      quasis.push(quasi)
      quasi = ''
      const close = matchBrace(src, i + 2)
      exprs.push(src.slice(i + 2, close))
      i = close + 1
    } else {
      quasi += c
      i += 1
    }
  }
  quasis.push(quasi)
  return { end: src.length, quasis, exprs }
}

/** Index of the `}` closing a `${`, skipping strings and nested templates. */
function matchBrace(src: string, start: number): number {
  let depth = 0
  let i = start
  while (i < src.length) {
    const c = src[i]
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      i = j + 1
    } else if (c === '`') {
      i = readTemplate(src, i + 1).end
    } else if (c === '{') {
      depth += 1
      i += 1
    } else if (c === '}') {
      if (depth === 0) return i
      depth -= 1
      i += 1
    } else {
      i += 1
    }
  }
  return src.length
}

const MUSTACHE_RE = /\{\{[\s\S]*?\}\}/g
const ATTR_RE = /(\s)([:@#]?[\w.:-]+|v-[\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g

function scanTag(tag: string, copy: string[]): string {
  return tag.replace(ATTR_RE, (whole, space: string, name: string, eq: string, value: string) => {
    const quote = value[0] ?? '"'
    const inner = value.slice(1, -1)
    if (/^[:@#]|^v-/.test(name))
      return `${space}${name}${eq}${quote}${scanScript(inner, copy)}${quote}`
    if (TEXT_ATTRS.has(name) && /[A-Za-z]/.test(inner)) {
      copy.push(inner)
      return `${space}${name}${eq}${quote}§A§${quote}`
    }
    return whole
  })
}

function scanText(node: string, copy: string[]): string {
  const expressions = node.match(MUSTACHE_RE) ?? []
  const masked = expressions.map((e) => `{{${scanScript(e.slice(2, -2), copy)}}}`)
  const words = node.replace(MUSTACHE_RE, '')
  if (!/[A-Za-z]/.test(words)) {
    let k = 0
    return node.replace(MUSTACHE_RE, () => masked[k++] ?? '')
  }
  copy.push(node.replace(MUSTACHE_RE, '{}').replace(/\s+/g, ' ').trim())
  // The words may be reflowed and reordered around the expressions, but the
  // expressions themselves stay, in order.
  return `§T§${masked.join('')}`
}

/** Mask copy in a Vue template: text nodes, text attributes, and bound expressions. */
function scanTemplate(src: string, copy: string[]): string {
  let out = ''
  let i = 0
  const n = src.length
  const startsTag = (k: number) => src[k] === '<' && /[A-Za-z/!]/.test(src[k + 1] ?? '')
  while (i < n) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i)
      const j = end < 0 ? n : end + 3
      out += src.slice(i, j)
      i = j
    } else if (startsTag(i)) {
      let j = i + 1
      let quote: string | null = null
      while (j < n) {
        const c = src[j]
        if (quote) {
          if (c === quote) quote = null
        } else if (c === '"' || c === "'") {
          quote = c
        } else if (c === '>') {
          break
        }
        j += 1
      }
      out += scanTag(src.slice(i, j + 1), copy)
      i = j + 1
    } else {
      let j = i
      while (j < n && !startsTag(j) && !src.startsWith('{{', j)) j += 1
      // A mustache may contain `<`, so read through it before looking for a tag.
      while (j < n && !startsTag(j)) {
        if (src.startsWith('{{', j)) {
          const close = src.indexOf('}}', j)
          j = close < 0 ? n : close + 2
        } else {
          j += 1
        }
      }
      out += scanText(src.slice(i, j), copy)
      i = j
    }
  }
  return out
}

/** Mask every piece of copy in a `.vue` or `.ts` file. */
export function scanCode(text: string, kind: 'vue' | 'ts'): Scan {
  const copy: string[] = []
  if (kind === 'ts') return { masked: scanScript(text, copy), copy }
  const blocks = text.split(/(?=^<(?:template|script|style)\b)/m)
  const masked = blocks
    .map((block) => {
      if (block.startsWith('<script')) return scanScript(block, copy)
      if (block.startsWith('<template')) {
        // Mask the inside of the block; the <template> tag itself and the
        // closing tag are code.
        const open = block.indexOf('>') + 1
        const close = block.lastIndexOf('</template>')
        if (close < open) return scanTemplate(block, copy)
        return (
          block.slice(0, open) + scanTemplate(block.slice(open, close), copy) + block.slice(close)
        )
      }
      return block
    })
    .join('')
  return { masked, copy }
}

/** Normalise a piece of copy for comparison: placeholders to `{}`, one space. */
function normalise(text: string): string {
  return text
    .replace(/\$\{[^}]*\}|\{\{[\s\S]*?\}\}|\{[^{}]*\}|<[^<>]*>/g, '{}')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Every string the design specs fix: bold spans, inline code, quotations and
 * table cells in `docs/design/<slug>/spec.md`. Keyed by normalised text, with
 * the spec it came from.
 */
export function specStrings(root: string = ROOT): Map<string, string> {
  const found = new Map<string, string>()
  const dir = join(root, 'docs/design')
  if (!existsSync(dir)) return found
  for (const slug of readdirSync(dir)) {
    const spec = join(dir, slug, 'spec.md')
    if (!existsSync(spec)) continue
    const rel = relative(root, spec).split(sep).join('/')
    const text = readFileSync(spec, 'utf8')
    const units = [
      ...allMatches(/\*\*([^*\n]+)\*\*/g, text),
      ...allMatches(/`([^`\n]+)`/g, text),
      ...allMatches(/"([^"\n]+)"|“([^”\n]+)”/g, text),
      ...text
        .split('\n')
        .filter((l) => l.trim().startsWith('|'))
        .flatMap((l) => l.split('|').map((cell) => cell.trim())),
    ]
    for (const unit of units) {
      const key = normalise(unit)
      if (/[A-Za-z]/.test(key) && !found.has(key)) found.set(key, rel)
    }
  }
  return found
}

/** A quoted run of at least two words, as a test or a doc would quote copy. */
const QUOTED_IN_CODE_RE = /'([^'\n]*\w \w[^'\n]*)'|"([^"\n]*\w \w[^"\n]*)"|`([^`\n]*\w \w[^`\n]*)`/g

export interface CodeCheckOptions {
  /** Normalised spec strings, from `specStrings`. */
  readonly spec?: Map<string, string>
  /** Test and doc files to search for the old wording, as [path, text]. */
  readonly quoting?: readonly (readonly [string, string])[]
}

export function checkCode(
  before: string,
  after: string,
  kind: 'vue' | 'ts',
  options: CodeCheckOptions = {},
): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (kind === 'vue') {
    const styles = (t: string) => t.match(/^<style\b[\s\S]*?^<\/style>/gm) ?? []
    if (styles(before).join('\n') !== styles(after).join('\n')) {
      errors.push('<style> changed; only user-facing text may change')
    }
  }
  const a = scanCode(before, kind)
  const b = scanCode(after, kind)
  if (a.masked !== b.masked) {
    const aLines = a.masked.split('\n')
    const bLines = b.masked.split('\n')
    const lost = aLines.filter((l) => !bLines.includes(l)).slice(0, 10)
    const added = bLines.filter((l) => !aLines.includes(l)).slice(0, 10)
    const detail = [...lost.map((l) => `\n    - ${l}`), ...added.map((l) => `\n    + ${l}`)].join(
      '',
    )
    errors.push(
      'code changed outside the copy (only template text, text attributes and string literals ' +
        'that read as words may change):' +
        (detail || ' lines moved'),
    )
  }

  const oldCopy = bag(a.copy.map(normalise))
  const newCopy = bag(b.copy.map(normalise))
  const numbersBefore = bag(a.copy.flatMap((c) => numbersIn(normalise(c))))
  const numbersAfter = bag(b.copy.flatMap((c) => numbersIn(normalise(c))))
  const numbersLost = minus(numbersBefore, numbersAfter)
  const numbersAdded = minus(numbersAfter, numbersBefore)
  if (numbersLost.size) errors.push(`numbers in the copy lost: ${show(numbersLost)}`)
  if (numbersAdded.size) errors.push(`numbers in the copy added: ${show(numbersAdded)}`)

  const removed = [...minus(oldCopy, newCopy).keys()]
  for (const text of removed) {
    const spec = options.spec?.get(text)
    if (spec) {
      errors.push(
        `${JSON.stringify(text)} is fixed by ${spec}; put it back, and raise any change as a ` +
          'deviation in your report',
      )
    }
  }
  // The literal runs of the old strings, between their expressions: what a
  // test or a doc would quote, whole or in part.
  const runs = removed.flatMap((text) =>
    text
      .split('{}')
      .map((s) => s.trim())
      .filter((s) => s.length >= 4),
  )
  if (runs.length) {
    for (const [path, body] of options.quoting ?? []) {
      body.split('\n').forEach((line, index) => {
        const quoted = allMatches(QUOTED_IN_CODE_RE, line)
        const hit =
          runs.find((run) => line.includes(run)) ??
          quoted.find((q) => runs.some((run) => run.includes(q)))
        if (hit) {
          warnings.push(
            `${path}:${index + 1} still has the old wording ${JSON.stringify(hit)}; ` +
              'update it if it asserts or quotes this string',
          )
        }
      })
    }
  }
  return { errors, warnings }
}

/** Test files, and docs outside docs/design/, that may quote UI wording. */
export function quotingFiles(root: string = ROOT): [string, string][] {
  const files = [
    ...walk(root, 'tests', (p) => p.endsWith('.ts')),
    ...walk(root, 'app', (p) => p.endsWith('.test.ts')),
    ...walk(root, 'shared', (p) => p.endsWith('.test.ts')),
    ...walk(root, 'docs', (p) => p.endsWith('.md') && !p.startsWith('docs/design/')),
    ...(existsSync(join(root, 'README.md')) ? ['README.md'] : []),
  ]
  return files.map((p) => [p, readFileSync(join(root, p), 'utf8')])
}

// -------------------------------------------------------------------- CLI ---

function headVersion(path: string, root: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function report({ errors, warnings }: CheckResult, okHint: string): number {
  for (const w of warnings) console.log(`WARNING ${w}`)
  for (const e of errors) console.log(`ERROR ${e}`)
  if (errors.length) return 1
  console.log(`ok${warnings.length ? ' (review the warnings above)' : ''}${okHint}`)
  return 0
}

const UI_VERIFY =
  ' (now run: bun run lint && bun run typecheck && bun run test:unit; ' +
  'and bun run test:e2e if the local stack is up)'

export function runCheck(path: string, root: string = ROOT): number {
  const never = neverReason(path)
  if (never) {
    console.log(`ERROR ${path} is never humanized: ${never}`)
    return 1
  }
  const before = headVersion(path, root)
  if (before === null) {
    console.log(`${path} is not in HEAD; commit it before humanizing.`)
    return 1
  }
  const after = readFileSync(join(root, path), 'utf8')
  if (SECURITY_COPY.includes(path)) {
    console.log(
      `WARNING ${path} is security copy. Only a person may ask for it, and every rule in its ` +
        'header comment still holds; flag the change for human review.',
    )
  }
  if (before === after) {
    console.log('unchanged')
    return 0
  }
  if (path.endsWith('.vue') || path.endsWith('.ts')) {
    const kind = path.endsWith('.vue') ? 'vue' : 'ts'
    const result = checkCode(before, after, kind, {
      spec: specStrings(root),
      quoting: quotingFiles(root),
    })
    return report(result, UI_VERIFY)
  }
  if (path.endsWith('.md')) return report(checkMarkdown(before, after), ' (now run: bun run lint)')
  console.log(`ERROR ${path}: only .vue, .ts and .md files are humanized`)
  return 1
}

export function main(argv: readonly string[], root: string = ROOT): number {
  const [cmd, ...rest] = argv
  const sweep: Sweep = rest.includes('--docs') ? 'docs' : 'ui'
  if (cmd === 'next' || cmd === 'status') {
    const { fresh, stale, done } = classify(sweep, root)
    if (cmd === 'status') {
      console.log(
        `${sweep} sweep: done: ${done.length}  never humanized: ${fresh.length}  ` +
          `changed since humanized: ${stale.length}`,
      )
      return 0
    }
    console.log([...fresh, ...stale][0] ?? 'ALL DONE')
    return 0
  }
  if ((cmd === 'check' || cmd === 'record') && rest.length === 1 && rest[0]) {
    const abs = resolve(root, rest[0])
    const path = relative(root, abs).split(sep).join('/')
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      console.log(`no such file: ${rest[0]}`)
      return 2
    }
    if (cmd === 'check') return runCheck(path, root)
    const never = neverReason(path)
    if (never) {
      console.log(`ERROR ${path} is never humanized: ${never}`)
      return 1
    }
    recordItem(path, root)
    console.log(`recorded ${path}`)
    return 0
  }
  console.log(
    'usage: bun scripts/humanize-copy.ts next [--docs] | status [--docs] | check PATH | record PATH',
  )
  return 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
