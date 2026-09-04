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

/**
 * `not-evaluated` is deliberately not `fail`: a candidate that was never
 * built (E, dropped per the plan's own risk table — see the checkpoint) must
 * not read as having *failed* the 375px gate, which is what a bare `fail`
 * would trigger in `CapabilityScorecard`'s "Disqualified" banner. Not
 * evaluated and failed are different claims, and the scorecard has to be
 * able to say which one it means.
 */
export type VerdictStatus = 'pass' | 'partial' | 'fail' | 'not-evaluated'

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
  /**
   * Set to the commit sha that removed this candidate's page and
   * dependencies once P8 prunes it. A candidate with this set was fully
   * evaluated (it has real verdicts, not `pendingVerdicts()`) but its page
   * no longer exists — distinct from `vue-chrts`, which was never built at
   * all. Revert that commit to bring the page back.
   */
  readonly prunedInCommit?: string
}

const NOT_YET_EVALUATED: CapabilityVerdict = {
  status: 'not-evaluated',
  note: "Not built in this spike — dropped per the plan's risk table; see docs/spikes/chart-library-bakeoff.md.",
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
    prunedInCommit: '5480530',
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
    prunedInCommit: '5480530',
    packages: [
      { name: 'echarts', version: '6.1.0', license: 'Apache-2.0' },
      { name: 'vue-echarts', version: '8.2.0', license: 'MIT' },
    ],
    verdicts: {
      multiSeries: {
        status: 'pass',
        note: "Each series' color comes from getComputedStyle on the account's own var(--chart-N) — resolved because canvas fillStyle can't read a var() the way an SVG attribute can (there is no element for the custom property to inherit through). Confirmed correct, distinct colours per account in the browser, both themes.",
      },
      cushionLine: {
        status: 'pass',
        note: 'markLine (labelled, dashed) + markArea (from range.min to cushion) are purpose-built for exactly this, same as the Unovis baseline — native primitives, not a hand-rolled rect and line.',
      },
      solidDashedSegments: {
        status: 'pass',
        note: 'Two line series per account (past/future halves of the same data, the other null) sharing one xAxis — the same two-series technique every non-incumbent candidate needed; ECharts has no native per-segment dash either. Confirmed a clean solid-to-dashed transition at Today in the browser.',
      },
      eventMarkers: {
        status: 'pass',
        note: 'A scatter series per account, one point only on days with an occurrence for that account, filled/hollow by direction. Confirmed visually in both themes.',
      },
      minimumPoint: {
        status: 'pass',
        note: 'A dedicated scatter point at the fixture\'s own lowest coordinate (not ECharts\' built-in markPoint type:"min", which would consider the look-back days the verdict excludes), styled and labelled to match the incumbent. Confirmed in the browser.',
      },
      tooltip: {
        status: 'pass',
        note: 'ECharts\' native axis-triggered tooltip + cross axisPointer, with a custom formatter for itemized rows. Took two real bugs to get there, both fixed and commented in EChartsChart.vue: (1) tooltip:{show:false} on the dashed "future" series — meant to hide a duplicate legend row — silently drops that series from the axis tooltip\'s params entirely, so hovering the future half of the line showed nothing; fixed by removing it and de-duplicating by name in the formatter instead. (2) hovering by default blurs series not at the exact hovered index, which reads as the past half of every line vanishing on hover; fixed with emphasis:{disabled:true}. Confirmed correct, itemized content on hover after both fixes.',
      },
      clickIdentity: {
        status: 'pass',
        note: "@click on VChart; params.name is the category axis value, which is the fixture's own IsoDate string — no decoding needed. Confirmed in the browser: clicking a rendered point returned its real date (Aug 22, 2026).",
      },
      legible375: {
        status: 'pass',
        note: 'Lines, cushion band, gridlines, Today marker, event markers and the Lowest marker are all legible in the 375px frame in both themes, with no clipping issues — the best rendered legibility of the non-incumbent candidates, arguably including the incumbent.',
      },
      themeCorrectness: {
        status: 'pass',
        note: 'Everything drawn is resolved via getComputedStyle and re-resolved on a colorMode.value watcher, so both themes render correctly with no remount — the whole option object recomputes, and vue-echarts patches the existing chart instance. This is the one candidate with no unresolved defect by the end of this spike.',
      },
    },
  },
  {
    slug: 'chartjs',
    name: 'Chart.js',
    role: 'challenger',
    prunedInCommit: '5480530',
    packages: [
      { name: 'chart.js', version: '4.5.1', license: 'MIT' },
      { name: 'vue-chartjs', version: '5.3.4', license: 'MIT' },
      { name: 'chartjs-plugin-annotation', version: '3.1.0', license: 'MIT' },
    ],
    verdicts: {
      multiSeries: {
        status: 'pass',
        note: "Each dataset's borderColor/backgroundColor comes from getComputedStyle on the account's own var(--chart-N) — same reason as ECharts, canvas fillStyle can't read a var() directly. Confirmed correct, distinct colours per account in the browser, both themes.",
      },
      cushionLine: {
        status: 'pass',
        note: "chartjs-plugin-annotation's line + box annotation types — the whole reason this dependency exists, since Chart.js core has no reference-line primitive at all. Confirmed labelled, dashed line and shaded band in the browser.",
      },
      solidDashedSegments: {
        status: 'pass',
        note: "Chart.js's segment.borderDash callback is the one candidate in this spike with a genuine single-line, per-segment primitive — no second dataset needed, unlike every other candidate including the incumbent. Confirmed a clean solid-to-dashed transition at Today in the browser.",
      },
      eventMarkers: {
        status: 'pass',
        note: 'pointRadius/pointBackgroundColor as per-index arrays, 0-radius everywhere except occurrence days. Confirmed filled/hollow markers on the right days in the browser, both themes.',
      },
      minimumPoint: {
        status: 'pass',
        note: 'Same per-point array mechanism as event markers, a bigger radius and a destructive border only at the fixture\'s lowest index, plus an annotation label type for the "Lowest" text. Confirmed in the browser.',
      },
      tooltip: {
        status: 'pass',
        note: "Chart.js's native mode:'index' tooltip with a callbacks.label formatter — itemized, correct content on the first attempt, no defect found. The only real issue on this whole page (a stray default-black point revealed on hover, from Chart.js applying a fixed pointHoverRadius/colour on top of a per-point array) was fixed by mirroring pointHoverRadius/pointHoverBackgroundColor/pointHoverBorderColor onto the same arrays.",
      },
      clickIdentity: {
        status: 'pass',
        note: "options.onClick(event, elements) with interaction:{mode:'index',intersect:false} — elements[0].index maps straight to the fixture's own day array, no decoding needed. Confirmed in the browser: clicking near a point returned its real date (Aug 25, 2026) on the first attempt.",
      },
      legible375: {
        status: 'pass',
        note: 'Lines, cushion band, Today marker, event markers and the Lowest marker are all legible in the 375px frame in both themes.',
      },
      themeCorrectness: {
        status: 'pass',
        note: 'Everything drawn is resolved via getComputedStyle and re-resolved on a colorMode.value watcher, same pattern as ECharts. Both themes render correctly with no remount.',
      },
    },
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

/**
 * Whether a candidate has a live `/lab/chart-bakeoff/<slug>` page to link to.
 * `false` for two different reasons the index page needs to tell apart: a
 * `prunedInCommit` candidate was built and evaluated, then its page was
 * deleted; a candidate whose verdicts are all still `NOT_YET_EVALUATED` was
 * never built at all, so it never had a page to begin with.
 */
export function candidateHasPage(candidate: CandidateReport): boolean {
  if (candidate.prunedInCommit) return false
  return Object.values(candidate.verdicts).some((verdict) => verdict.status !== 'not-evaluated')
}
