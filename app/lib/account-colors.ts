/**
 * Account color → Tailwind class.
 *
 * A lookup rather than an interpolated `bg-chart-${n}`: Tailwind scans source
 * text for complete class names, so a constructed one is never emitted and the
 * swatch silently renders transparent. Every class here is written out in full
 * so the scanner can see it.
 */

import type { AccountColor } from '~~/domain/types'

interface ColorClasses {
  /** Human-readable name — the swatch's accessible label, since a token id read aloud is useless. */
  readonly label: string
  readonly background: string
  readonly text: string
  readonly stroke: string
}

export const ACCOUNT_COLOR_CLASSES: Record<AccountColor, ColorClasses> = {
  'chart-2': {
    label: 'Green',
    background: 'bg-chart-2',
    text: 'text-chart-2',
    stroke: 'stroke-chart-2',
  },
  'chart-3': {
    label: 'Blue',
    background: 'bg-chart-3',
    text: 'text-chart-3',
    stroke: 'stroke-chart-3',
  },
  'chart-4': {
    label: 'Indigo',
    background: 'bg-chart-4',
    text: 'text-chart-4',
    stroke: 'stroke-chart-4',
  },
}

export function accountColorClasses(color: AccountColor): ColorClasses {
  return ACCOUNT_COLOR_CLASSES[color]
}

/**
 * The CSS variable backing a color, for SVG attributes.
 *
 * Chart strokes are set through `stroke` attributes rather than utilities, so
 * the raw `var(--chart-N)` is needed there. Still a token reference, never a
 * literal color.
 */
export function accountColorVar(color: AccountColor): string {
  return `var(--${color})`
}
