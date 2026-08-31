/**
 * The single definition of what a form field looks like.
 *
 * This exists for the same reason `segmented-control.ts` does, and after the
 * same failure. `MoneyInput` wrapped its input in a hand-rolled box so it could
 * put a `$` prefix and a sign toggle beside the text, and that box drifted from
 * `Input` on three properties at once — 8px corners against the field's 32px
 * pill, an opaque `--background` fill against `--input`/30, and a different
 * height. Three fields sat in one row of the account editor and one of them was
 * visibly a different control. Nobody changed it; it was simply never the same.
 *
 * So the shell is a constant that both components apply, and a field that looks
 * wrong now looks wrong everywhere at once — which is the property that gets it
 * noticed and fixed.
 *
 * Split into parts because the focus ring is the one piece that genuinely
 * differs: a bare `<input>` rings on `focus-visible`, and a wrapper containing
 * an input has to ring on `focus-within` or the ring never appears at all.
 */

/**
 * Border, fill, radius, padding and height. Everything that makes a field read
 * as a field.
 *
 * `h-11 lg:h-9` rather than a flat `h-9`: 44px is the touch minimum this
 * codebase already holds every other tap target to — the segmented controls,
 * the legend rows, the chart's cushion trigger — and
 * `docs/design/accounts/spec.md` line 202 raises a 28×28 control as a defect
 * for exactly this reason. Text inputs were the one interactive surface still
 * at 36px on a phone. Desktop is unchanged.
 */
export const FIELD_SHELL = [
  'h-11 w-full min-w-0 lg:h-9',
  'rounded-4xl border border-input bg-input/30',
  'px-3 py-1 text-base transition-colors md:text-sm',
].join(' ')

/** For a field that is itself the focusable element. */
export const FIELD_FOCUS =
  'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/** For a wrapper whose focusable element is inside it — `MoneyInput`'s box. */
export const FIELD_FOCUS_WITHIN =
  'outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50'

export const FIELD_INVALID = [
  'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
  'dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
].join(' ')

export const FIELD_DISABLED =
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Strips the shell off an `Input` that is being nested inside one.
 *
 * `MoneyInput` puts the shell on its wrapper, so the inner `Input` has to give
 * every one of those properties back — including **both** height variants.
 * `h-11 lg:h-9` is two classes to tailwind-merge, and overriding only the base
 * one leaves the field 36px tall inside a 44px box on desktop.
 */
export const FIELD_UNSTYLED = [
  'h-auto lg:h-auto self-stretch',
  'rounded-none border-0 bg-transparent px-0 py-0 shadow-none',
  'focus-visible:ring-0 focus-visible:border-transparent',
].join(' ')
