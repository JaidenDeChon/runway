/**
 * `scripts/humanize-copy.ts` is the guard that lets an agent reword the app's
 * copy unattended: it masks the words and fails when anything else changed.
 * A guard that silently passes a code change is worse than no guard, so each
 * rule here is proved from both sides: the copy edit it must allow, and the
 * change it must refuse.
 *
 * No browser, no app, no stack. The queue tests build a throwaway repo in a
 * temp directory; nothing here reads or writes the real ledger.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkCode,
  checkMarkdown,
  classify,
  isCopy,
  neverReason,
  recordItem,
  SECURITY_COPY,
  scanCode,
  sweepItems,
} from '../../scripts/humanize-copy'

const VUE = `<script setup lang="ts">
// The label is spoken for the icon-only button.
const label = computed(() => (open.value ? 'Hide the chart settings' : 'Show the chart settings'))
const classes = 'h-11 w-full rounded-4xl'
console.warn('density panel opened twice')
</script>

<template>
  <Card :class="['bg-card text-foreground', open ? 'ring-2' : '']">
    <h2 id="density-title" class="text-sm font-medium">Chart display</h2>
    <p>Showing {{ count }} of {{ total }} accounts</p>
    <Button aria-label="Close the chart settings" @click="open = false">Done</Button>
  </Card>
</template>

<style scoped>
.fade-enter-active {
  transition: opacity 150ms ease;
}
</style>
`

function edit(text: string, from: string, to: string): string {
  expect(text).toContain(from)
  return text.replace(from, to)
}

describe('isCopy', () => {
  it.each([
    ['Save changes'],
    ['Covered'],
    ['Sending…'],
    ['to keep  in reserve through .'],
    ['e.g. Checking'],
  ])('treats %j as copy', (text) => {
    expect(isCopy(text)).toBe(true)
  })

  it.each([
    ['h-11 w-full min-w-0 lg:h-9'],
    ['user_id, cushion_cents, time_zone'],
    ['opacity 150ms ease'],
    ['magic-link'],
    ['covered'],
    ['Escape'],
    ['M0 0 L10 10'],
  ])('treats %j as code', (text) => {
    expect(isCopy(text)).toBe(false)
  })
})

describe('checkCode on a .vue file', () => {
  it('allows rewording template text, text attributes and copy literals', () => {
    let after = edit(VUE, 'Chart display', 'How the chart looks')
    after = edit(
      after,
      'Showing {{ count }} of {{ total }} accounts',
      '{{ count }} of {{ total }} accounts shown',
    )
    after = edit(after, 'Close the chart settings', 'Close these settings')
    after = edit(after, "'Hide the chart settings'", "'Hide these settings'")
    expect(checkCode(VUE, after, 'vue')).toEqual({ errors: [], warnings: [] })
  })

  it.each([
    ['a class in a template', 'text-sm font-medium', 'text-base font-medium'],
    ['a class list in script', 'h-11 w-full', 'h-12 w-full'],
    ['a bound class', "'bg-card text-foreground'", "'bg-muted text-foreground'"],
    ['an id', 'id="density-title"', 'id="density-heading"'],
    ['an event handler', '@click="open = false"', '@click="open = !open"'],
    ['a mustache expression', '{{ total }}', '{{ total + 1 }}'],
    ['a comment', 'is spoken for', 'is read out for'],
    ['a developer message', 'density panel opened twice', 'density panel reopened'],
  ])('refuses a change to %s', (_what, from, to) => {
    expect(checkCode(VUE, edit(VUE, from, to), 'vue').errors).not.toEqual([])
  })

  it('refuses a change to <style>', () => {
    const { errors } = checkCode(VUE, edit(VUE, '150ms', '200ms'), 'vue')
    expect(errors).toContain('<style> changed; only user-facing text may change')
  })

  it('masks the copy it allows to change', () => {
    const { masked, copy } = scanCode(VUE, 'vue')
    expect(copy).toContain('Chart display')
    expect(copy).toContain('Showing {} of {} accounts')
    expect(masked).toContain('id="density-title"')
    expect(masked).not.toContain('Chart display')
  })
})

/**
 * TypeScript source for the fixtures below, written with `$[expr]` so this
 * file holds no `${}` inside a plain string; `js` turns it into the real thing.
 */
function js(text: string): string {
  return text.replace(/\$\[([^\]]+)\]/g, (_match, expr: string) => ['$', '{', expr, '}'].join(''))
}

describe('checkCode on a .ts file', () => {
  const TS = js(
    [
      'export function hint(day: string, label: string): string {',
      '  return `Update one changes $[day] alone. Update all changes every $[label].`',
      '}',
      "export const LOAD_ERROR = 'Could not load the last 3 readings.'",
      '',
    ].join('\n'),
  )

  it('allows moving words around an expression', () => {
    const after = edit(
      TS,
      js('Update one changes $[day] alone.'),
      js('Only $[day] changes with Update one.'),
    )
    expect(checkCode(TS, after, 'ts').errors).toEqual([])
  })

  it('refuses a changed expression inside a template literal', () => {
    const after = edit(TS, js('$[label]'), js('$[label.toLowerCase()]'))
    expect(checkCode(TS, after, 'ts').errors).not.toEqual([])
  })

  it('refuses a lost number in the copy', () => {
    const after = edit(TS, 'the last 3 readings', 'the latest readings')
    expect(checkCode(TS, after, 'ts').errors).toEqual(['numbers in the copy lost: "3"'])
  })

  it('refuses an added number in the copy', () => {
    const after = edit(TS, 'Could not load', 'Could not load, after 2 tries,')
    expect(checkCode(TS, after, 'ts').errors).toEqual(['numbers in the copy added: "2"'])
  })

  it('refuses a change to a string a design spec fixes', () => {
    const spec = new Map([['Could not load the last 3 readings.', 'docs/design/x/spec.md']])
    const after = edit(TS, 'Could not load the last', 'Could not fetch the last')
    const { errors } = checkCode(TS, after, 'ts', { spec })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('is fixed by docs/design/x/spec.md')
  })

  it('names a test that still quotes the old wording', () => {
    const quoting = [
      ['tests/e2e/x.spec.ts', "await page.getByText('Could not load the last')"],
    ] as const
    const after = edit(TS, 'Could not load the last', 'Could not fetch the last')
    const { warnings } = checkCode(TS, after, 'ts', { quoting })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^tests\/e2e\/x\.spec\.ts:1 still has the old wording/)
  })
})

describe('checkMarkdown', () => {
  const MD = [
    '# Testing',
    '',
    'Run `bun run test:unit` first. It needs nothing, and it must pass before',
    'you open a PR. See [the guide](./docs/testing.md) for the 4 suites.',
    '',
    '| Suite | Needs |',
    '| --- | --- |',
    '| unit | nothing |',
    '',
    '```bash',
    'bun run test',
    '```',
    '',
  ].join('\n')

  it('allows rewording prose and table cells', () => {
    let after = edit(MD, 'It needs nothing, and it', 'It needs no setup and')
    after = edit(after, '| unit | nothing |', '| unit | no setup |')
    expect(checkMarkdown(MD, after)).toEqual({ errors: [], warnings: [] })
  })

  it.each([
    ['a link', 'See [the guide](./docs/testing.md) for', 'See the guide for', 'links lost'],
    ['a number', 'the 4 suites', 'the suites', 'numbers lost'],
    ['inline code', '`bun run test:unit`', 'the unit suite', 'inline code lost'],
    ['a heading', '# Testing', '# Tests', 'headings'],
    ['a code block', 'bun run test\n', 'bun run test:unit\n', 'headings'],
    ['a table column', '| unit | nothing |', '| unit | nothing | none |', 'table shape'],
  ])('refuses a change to %s', (_what, from, to, message) => {
    const { errors } = checkMarkdown(MD, edit(MD, from, to))
    expect(errors.join('\n')).toContain(message)
  })

  it('warns when a rule word is gone', () => {
    const { errors, warnings } = checkMarkdown(MD, edit(MD, 'it must pass', 'it should pass'))
    expect(errors).toEqual([])
    expect(warnings.join('\n')).toContain('fewer rule words: "must"')
  })
})

describe('the queue', () => {
  let root = ''

  function file(path: string, text: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('never offers locked files, and offers unlisted components after the listed ones', () => {
    root = mkdtempSync(join(tmpdir(), 'humanize-copy-'))
    file('app/lib/navigation.ts', "export const title = 'Home'\n")
    file('app/components/ZNew.vue', '<template><p>New</p></template>\n')
    file('app/components/ui/button/Button.vue', '<template><slot /></template>\n')
    file('app/pages/lab/chart-bakeoff/index.vue', '<template><p>Lab</p></template>\n')
    expect(sweepItems('ui', root)).toEqual(['app/lib/navigation.ts', 'app/components/ZNew.vue'])
  })

  it('moves a file to done when recorded, and back into the queue when it changes', () => {
    root = mkdtempSync(join(tmpdir(), 'humanize-copy-'))
    file('README.md', '# Runway\n')
    file('docs/testing.md', '# Testing\n')
    file('docs/design/dashboard/spec.md', '# Dashboard\n')
    mkdirSync(join(root, '.claude'))

    expect(classify('docs', root).fresh).toEqual(['README.md', 'docs/testing.md'])
    recordItem('README.md', root)
    expect(classify('docs', root)).toEqual({
      fresh: ['docs/testing.md'],
      stale: [],
      done: ['README.md'],
    })
    file('README.md', '# Runway\n\nChanged.\n')
    expect(classify('docs', root).stale).toEqual(['README.md'])
  })

  it.each([
    ['docs/design/shortfall/spec.md'],
    ['app/components/ui/button/Button.vue'],
    ['CLAUDE.md'],
    ['app/lib/format.ts'],
    ['tests/e2e/dashboard.spec.ts'],
    ['domain/projection.ts'],
  ])('locks %s', (path) => {
    expect(neverReason(path)).not.toBeNull()
  })

  it('keeps security copy out of every sweep', () => {
    const swept = [...sweepItems('ui'), ...sweepItems('docs')]
    expect(SECURITY_COPY.filter((path) => swept.includes(path))).toEqual([])
  })
})
