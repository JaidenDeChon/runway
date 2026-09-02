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
    verdicts: pendingVerdicts(),
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
