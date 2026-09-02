/**
 * The nine capabilities issue #10 asks every candidate to demonstrate.
 *
 * A typed const array rather than nine separate booleans scattered through
 * `candidates.ts`, so the scorecard, the matrix in `docs/spikes/…` and every
 * candidate page render the exact same list in the exact same order — adding a
 * tenth capability means editing this file once, not four.
 *
 * `gate: true` marks the one item (#8, legibility at 375px) the issue treats as
 * pass/fail rather than scored: a candidate that fails it is disqualified
 * regardless of how well it does on the other eight, and the report says so in
 * those words rather than averaging it into a score.
 */

export type CapabilityId =
  | 'multiSeries'
  | 'cushionLine'
  | 'solidDashedSegments'
  | 'eventMarkers'
  | 'minimumPoint'
  | 'tooltip'
  | 'clickIdentity'
  | 'legible375'
  | 'themeCorrectness'

export interface Capability {
  readonly id: CapabilityId
  readonly label: string
  readonly gate: boolean
}

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'multiSeries',
    label: 'Multi-series line with per-series color from theme tokens',
    gate: false,
  },
  {
    id: 'cushionLine',
    label: 'A labeled horizontal reference line (the cushion) with shaded region below',
    gate: false,
  },
  {
    id: 'solidDashedSegments',
    label: 'Visually distinct solid past segments and dashed future segments on the same line',
    gate: false,
  },
  {
    id: 'eventMarkers',
    label: 'Event markers on specific dates',
    gate: false,
  },
  {
    id: 'minimumPoint',
    label: 'A highlighted, labeled minimum point',
    gate: false,
  },
  {
    id: 'tooltip',
    label: 'Crosshair or tooltip with custom itemized content',
    gate: false,
  },
  {
    id: 'clickIdentity',
    label: "Click on a data point returning that point's identity",
    gate: false,
  },
  {
    id: 'legible375',
    label: 'Legible at 375px width',
    gate: true,
  },
  {
    id: 'themeCorrectness',
    label: 'Correct rendering in light and dark themes',
    gate: false,
  },
] as const
