/**
 * The single definition of a segmented control's appearance.
 *
 * Every spec describes this control the same way — the track sits on `--accent`
 * and the selected segment "lifts" to `--card` (`docs/design/recurring-items/
 * spec.md` line 206, `docs/design/dashboard/spec.md` line 291) — but the app
 * builds it from two different primitives depending on whether the segments own
 * panels: `Tabs` where they do, `ToggleGroup` where the control only picks a
 * value. Swapping either primitive for the other would cost real accessibility,
 * so the shared thing is the styling, not the component.
 *
 * Both primitives' selected-child selectors are spelled out below because they
 * disagree — reka-ui marks an active tab with `data-active` and an engaged
 * toggle with `data-state="on"` — and Tailwind scans source text for whole class
 * names, so the variant prefix cannot be assembled at runtime.
 *
 * `--card` reads as a lift in both themes without a dark-mode special case: it
 * is white against a light grey track in light, and in dark it matches the
 * surrounding card surface while the track sits darker beneath it.
 *
 * The `!`s are aimed at `ToggleGroupItem`, which ships
 * `group-data-[spacing=0]/toggle-group:rounded-none` and `…:shadow-none`. Those
 * are descendant selectors, so they outrank a bare utility arriving via
 * `props.class` regardless of how tailwind-merge orders the string.
 *
 * Sizing is deliberately not here. Height, width and padding vary by placement
 * and belong to the caller.
 */

/** The recessed well the segments sit in. Pair with `SEGMENTED_SEGMENT`. */
export const SEGMENTED_TRACK = 'rounded-lg bg-accent p-0.5'

/**
 * One segment. `rounded-md` is `rounded-lg` minus the track's 2px padding, which
 * is what makes a segment read as part of the track rather than a tile dropped
 * on top of it.
 */
export const SEGMENTED_SEGMENT = [
  'rounded-md!',
  // Tabs.
  'data-active:bg-card data-active:text-foreground data-active:shadow-sm',
  'dark:data-active:bg-card dark:data-active:border-transparent',
  // ToggleGroup.
  'data-[state=on]:bg-card! data-[state=on]:text-foreground data-[state=on]:shadow-sm!',
].join(' ')
