/**
 * One `CandidateReport` per chart-library candidate.
 *
 * Declared here and imported by both the candidate pages (so the in-browser
 * scorecard renders it) and `docs/spikes/chart-library-bakeoff.md` (so the
 * document's table cannot disagree with what shipped). There is exactly one
 * source of truth for a verdict.
 *
 * Every `CapabilityVerdict` must come from something actually observed on a
 * running candidate page — clicking, resizing to 375px, flipping the theme —
 * never from a library's documentation. A verdict written from docs makes this
 * whole spike worthless (issue #10, "what the report must not do").
 *
 * `role` is what keeps the scorecard from reading as a flat five-way
 * comparison: `incumbent` and `baseline` are the two privileged candidates
 * (F2 in the plan) and every `challenger` has to beat both, not just place
 * somewhere in a ranking.
 */

import type { CapabilityId } from './capabilities'
import { CAPABILITIES } from './capabilities'

export type VerdictStatus = 'pass' | 'partial' | 'fail'

export interface CapabilityVerdict {
  readonly status: VerdictStatus
  readonly note: string
}

export interface CandidatePackage {
  readonly name: string
  readonly version: string
  readonly license: string
}

export type CandidateRole = 'incumbent' | 'baseline' | 'challenger'

export interface CandidateReport {
  readonly slug: string
  readonly name: string
  readonly role: CandidateRole
  /** Empty for the incumbent — it adds no new dependency. */
  readonly packages: readonly CandidatePackage[]
  readonly verdicts: Record<CapabilityId, CapabilityVerdict>
}

const NOT_YET_EVALUATED: CapabilityVerdict = {
  status: 'fail',
  note: 'Not yet built and observed in this spike.',
}

function pendingVerdicts(): Record<CapabilityId, CapabilityVerdict> {
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [capability.id, NOT_YET_EVALUATED]),
  ) as Record<CapabilityId, CapabilityVerdict>
}

export const CANDIDATES: readonly CandidateReport[] = [
  {
    slug: 'svg',
    name: 'Incumbent — hand-rolled SVG',
    role: 'incumbent',
    packages: [],
    verdicts: {
      multiSeries: {
        status: 'pass',
        note: 'Each series gets var(--chart-N) from account.color; verified in browser at /lab/chart-bakeoff/svg. In this fixture the Savings line (flat $45) sits near the bottom of a range dominated by Checking, so it reads faint relative to Checking/Combined — a fixture artifact, not a rendering defect.',
      },
      cushionLine: {
        status: 'pass',
        note: 'Dashed "Safety cushion · $250" line with a Popover explainer, plus the destructive/10 danger band below it. Confirmed in both themes.',
      },
      solidDashedSegments: {
        status: 'fail',
        note: 'dashArrayFor() dashes by series INDEX (to tell overlapping accounts apart), not by date. There is a vertical "Today" marker, but the line itself does not switch from solid to dashed at today — capability 3 asks for that switch on one line and this component does not do it.',
      },
      eventMarkers: {
        status: 'pass',
        note: 'A marker circle is drawn on every day an occurrence lands, filled for income and hollow for bills — confirmed visually in the zoomed screenshot.',
      },
      minimumPoint: {
        status: 'pass',
        note: '9px destructive-ring circle plus a "Lowest · <date>" label. The label is HTML-positioned and can run past the visible edge when the low point falls at the window\'s right edge in the 375px frame — see the legible375 note.',
      },
      tooltip: {
        status: 'pass',
        note: 'Hovering (and keyboard focus) shows a card-styled tooltip itemising every series plus Combined, each with its own swatch and MoneyText — confirmed in browser (Aug 28: Checking $617, Savings $45, Combined $662).',
      },
      clickIdentity: {
        status: 'pass',
        note: "Clicking a day's hit-rect emits selectDay(date); the harness's readout confirmed it returns the clicked day's actual date (Aug 14, 2026).",
      },
      legible375: {
        status: 'pass',
        note: 'Lines, cushion band, gridlines, ticks and Today marker are all legible in the 375px frame in both themes. Caveat: the "Lowest" text label can clip against the frame edge when the low point lands late in the window — the marker itself stays visible and the label is present in the DOM (reachable by scrolling the frame), so this does not fail the gate, but it is a real, observed rough edge.',
      },
      themeCorrectness: {
        status: 'pass',
        note: 'Every colour is a Tailwind token class or a var(--chart-N) — no literal colours. Confirmed both themes render correctly with no remount needed (toggling dark mode updates instantly).',
      },
    },
  },
  {
    slug: 'unovis',
    name: 'Designated baseline — @unovis/vue + shadcn-vue chart chassis',
    role: 'baseline',
    packages: [
      { name: '@unovis/vue', version: '1.6.7', license: 'Apache-2.0' },
      { name: '@unovis/ts', version: '1.6.7', license: 'Apache-2.0' },
    ],
    verdicts: {
      multiSeries: {
        status: 'pass',
        note: "ChartConfig maps each series id to the account's own var(--chart-N) via entry.stroke (fixture.ts); ChartStyle emits a scoped --color-<key> var that every VisLine/VisScatter reads. Confirmed correct colours per account in the browser.",
      },
      cushionLine: {
        status: 'pass',
        note: "VisPlotline (labelText, dashed) + VisPlotband (from range.min to cushion) are purpose-built for exactly this — less code than the incumbent needed. Required an explicit labelOffsetX to stop the label clipping the frame's left edge at 375px.",
      },
      solidDashedSegments: {
        status: 'pass',
        note: "Two VisLine layers (past/future slices of the same rows) sharing one VisXYContainer — confirmed a clean solid-to-dashed transition exactly at the Today marker in the browser. Composition, not a single-line primitive, but it works and is little more code than the incumbent's per-series dash approach.",
      },
      eventMarkers: {
        status: 'partial',
        note: "VisScatter's own :data prop is not honoured per-component (see candidates.ts and UnovisChart.vue) — confirmed by isolating a scatter bound to a verified one-row computed and finding all 45 container rows rendered instead. Worked around by binding every scatter to the container's own rows and returning undefined from y() for days with no occurrence. Correct once worked around; partial because the documented API (a component-local data array) does not do what it says.",
      },
      minimumPoint: {
        status: 'partial',
        note: "Same workaround as event markers — a single highlighted, labelled point, correct once built around the data-override defect. Also needed an explicit labelColor: Unovis's own default label colour only switches for dark mode under html.dark-theme / html[data-theme=dark], which this app never sets (its dark mode is a bare .dark class) — left alone, the label was near-illegible in dark mode. Confirmed by reading unovis/ts/utils/theme.js, not guessed.",
      },
      tooltip: {
        status: 'partial',
        note: "The crosshair itself tracks the pointer correctly — its indicator circles land on the right series at the right x, confirmed in the browser. But the itemized tooltip content never appears: componentToString + ChartTooltipContent is the chassis's own documented pattern, wired exactly as shown, and no populated tooltip node ever appears in the DOM on hover. Root cause not confirmed within this spike's budget; componentToString is also the source of the hydration mismatch below, which makes one bug in that function more likely than two separate ones.",
      },
      clickIdentity: {
        status: 'pass',
        note: "A transparent VisScatter on the drawn line's actual points, wired through @unovis/ts's Scatter.selectors.point click event. Confirmed in the browser: clicking a rendered point returns its real date (Aug 23, 2026). Needed to be redesigned once — an initial full-height hit-strip (mirroring the incumbent's day-bands) doesn't fit the Scatter primitive, which only offers point-sized hit targets.",
      },
      legible375: {
        status: 'pass',
        note: 'Lines, cushion band, gridlines, ticks, Today marker and the Lowest marker are all legible in the 375px frame in both themes once the label-clipping and dark-label-colour issues above are fixed. Every one of those fixes was necessary to reach this — none was optional polish.',
      },
      themeCorrectness: {
        status: 'partial',
        note: "Every colour this file sets is explicit (var(--chart-N), var(--muted-foreground), color-mix() over var(--destructive)/var(--foreground)) and both themes render correctly for those. But the chassis's OWN defaults do not: Unovis ships dark-mode CSS selectors (html.dark-theme, html[data-theme=dark], etc. — unovis/ts/utils/theme.js) that don't match this app's actual dark-mode class, so anything left on an Unovis default stays wrong in dark mode unless the integrator notices and overrides it by hand.",
      },
    },
  },
  {
    slug: 'echarts',
    name: 'Apache ECharts',
    role: 'challenger',
    packages: [],
    verdicts: pendingVerdicts(),
  },
  {
    slug: 'chartjs',
    name: 'Chart.js',
    role: 'challenger',
    packages: [],
    verdicts: pendingVerdicts(),
  },
  {
    slug: 'vue-chrts',
    name: 'vue-chrts (nuxt-charts)',
    role: 'challenger',
    packages: [],
    verdicts: pendingVerdicts(),
  },
] as const

export function candidateBySlug(slug: string): CandidateReport | undefined {
  return CANDIDATES.find((candidate) => candidate.slug === slug)
}
