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
    packages: [],
    verdicts: pendingVerdicts(),
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
