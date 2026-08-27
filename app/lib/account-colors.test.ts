/**
 * The bridge between a domain color and the repo's tokens.
 *
 * Nothing here is about how the swatches look. It is about the two ways this
 * mapping can fail silently, both of which render *something* and are therefore
 * invisible to a screenshot:
 *
 * 1. **A color the domain offers that this table has no row for.** `AccountColor`
 *    is a union, so a fourth member added to it makes `Record<AccountColor, …>`
 *    a compile error — but only for code that typechecks against the domain.
 *    The lookup returning `undefined` at runtime is what the accounts screen
 *    would actually do, and a missing swatch reads as a styling glitch rather
 *    than as a bug.
 * 2. **A class name Tailwind never emitted.** The module's own comment says why
 *    every class is written out in full: the scanner reads source text, so
 *    `bg-chart-${n}` produces no CSS and the swatch renders transparent. That
 *    invariant is a property of the *source file*, so it is checked against the
 *    source file.
 *
 * The token half is checked against `app/assets/css/tailwind.css` rather than
 * assumed, because CLAUDE.md's rule is that tokens come from the repo — a color
 * pointing at a `--chart-N` nobody defined is the exact failure that rule exists
 * to prevent, and it must hold in both themes.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_COLORS } from '~~/domain/types'
import { ACCOUNT_COLOR_CLASSES, accountColorClasses, accountColorVar } from './account-colors'

const source = readFileSync(fileURLToPath(new URL('./account-colors.ts', import.meta.url)), 'utf8')

const tailwindCss = readFileSync(
  fileURLToPath(new URL('../assets/css/tailwind.css', import.meta.url)),
  'utf8',
)

/**
 * The custom-property declarations inside one CSS block.
 *
 * Both themes declare the same variable names, so a naive file-wide grep would
 * pass while one of the two blocks was missing the token entirely — which is
 * precisely the "works in light, invisible in dark" bug this is here to catch.
 */
function declaredIn(selector: string): Set<string> {
  const block = tailwindCss.split(`${selector} {`)[1]?.split('\n}')[0] ?? ''
  return new Set(Array.from(block.matchAll(/^\s*(--[\w-]+):/gm), (match) => match[1] as string))
}

const lightTokens = declaredIn(':root')
const darkTokens = declaredIn('.dark')

describe('the account color table', () => {
  it('has a row for every color the domain offers, and no others', () => {
    expect(Object.keys(ACCOUNT_COLOR_CLASSES).sort()).toEqual([...ACCOUNT_COLORS].sort())
  })

  it('resolves every domain color to classes, with no undefined lookup', () => {
    for (const color of ACCOUNT_COLORS) {
      expect(accountColorClasses(color), color).toBeDefined()
    }
  })

  it('names each color in words, since the swatch is read aloud as its label', () => {
    const labels = ACCOUNT_COLORS.map((color) => accountColorClasses(color).label)
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0)
      // "chart-3" spoken aloud tells a screen-reader user nothing about which
      // account they are looking at.
      expect(label).not.toMatch(/chart-\d/)
    }
    expect(new Set(labels).size, 'two accounts sharing a spoken color name').toBe(labels.length)
  })
})

describe('the class names Tailwind has to find', () => {
  it('writes every one out in full, so the scanner can see it', () => {
    for (const color of ACCOUNT_COLORS) {
      const classes = accountColorClasses(color)
      for (const className of [classes.background, classes.text, classes.stroke]) {
        // The literal string, in the source, with no interpolation around it.
        expect(source, `${className} is not written out in full`).toContain(`'${className}'`)
      }
    }
  })

  it('points each utility at the color it belongs to', () => {
    for (const color of ACCOUNT_COLORS) {
      const classes = accountColorClasses(color)
      expect(classes.background).toBe(`bg-${color}`)
      expect(classes.text).toBe(`text-${color}`)
      expect(classes.stroke).toBe(`stroke-${color}`)
    }
  })
})

describe('the CSS variable behind a color', () => {
  it('is a token reference, never a literal color', () => {
    for (const color of ACCOUNT_COLORS) {
      expect(accountColorVar(color)).toBe(`var(--${color})`)
    }
  })

  it('names a token the repo actually defines, in both themes', () => {
    for (const color of ACCOUNT_COLORS) {
      const token = `--${color}`
      expect(lightTokens, `${token} is undefined in :root`).toContain(token)
      expect(darkTokens, `${token} is undefined in .dark`).toContain(token)
    }
  })

  it('read the stylesheet it is asserting against', () => {
    // Without this, a rename of the file or of either selector would empty both
    // sets and turn the check above into a test that passes over nothing.
    expect(lightTokens.size).toBeGreaterThan(ACCOUNT_COLORS.length)
    expect(darkTokens.size).toBeGreaterThan(ACCOUNT_COLORS.length)
  })

  it('leaves --chart-1 and --chart-5 to their fixed roles', () => {
    // The stylesheet reserves them: --chart-1 is the combined burndown line and
    // --chart-5 is what-if tinting. Offering either as an account color would
    // make a user's account indistinguishable from the combined total.
    expect(ACCOUNT_COLORS).not.toContain('chart-1')
    expect(ACCOUNT_COLORS).not.toContain('chart-5')
  })
})
