/**
 * The single definition of an inline "go somewhere" link.
 *
 * Four screens end a card with the same affordance — a text link carrying a
 * trailing arrow, pointing at the place that fills the gap the card is
 * describing. They had drifted: three carried the themed focus ring and the
 * dashboard's carried none, so the same control focused differently depending
 * on which empty state you reached it from.
 *
 * The ring is `--ring` at 50%, matching every other focusable control in the
 * app, and `focus-visible:` rather than `focus:` so it appears for keyboard
 * navigation without firing on a mouse click.
 *
 * `min-h-11` is the 44px touch target, not decoration — these links are the
 * only way out of an empty state on a phone.
 *
 * Positional spacing (`mt-3` and the like) belongs at the call site: it says
 * where the link sits in its card, not what a link is.
 */
export const ARROW_LINK =
  'inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
