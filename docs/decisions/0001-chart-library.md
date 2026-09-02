# 0001 — Chart library for the burndown chart

**Status:** decided, held for review. Never self-merged — see
`docs/spikes/chart-library-bakeoff.md` for how this spike is shipped.
**Date:** 2026-09-02
**Driven by:** [issue #10](https://github.com/JaidenDeChon/runway/issues/10)

`docs/decisions/` starts here. Numbered ADRs are a convention this repo can
carry forward from this point.

---

## Context

The burndown chart (`app/components/dashboard/BurndownChart.vue`) is a
hand-rolled inline SVG, backed by `app/lib/burndown.ts` (293 lines of tested
pixel geometry). It was built because, at the time, "there is no shadcn-vue
chart primitive in the registry" (`docs/design/dashboard/spec.md`, now
corrected). That premise turned out to be stale: shadcn-vue does ship a
`chart` registry item, a chassis around `@unovis/vue`.

Issue #10 asked for a bake-off: build the same chart against several
candidate libraries, using one fixed synthetic dataset, and score each
against nine capabilities the issue names, with 375px legibility as a
pass/fail gate rather than a score. The full evidence — the capability
matrix, bundle deltas from real builds, verified licenses, and what fought
back building each candidate — is in
`docs/spikes/chart-library-bakeoff.md`. This document is the decision drawn
from it.

Four candidates were built and driven in a browser: the incumbent
hand-rolled SVG (`svg`), the design system's own designated baseline
(`unovis` — `@unovis/vue` inside the shadcn-vue chassis), and two
independent challengers (`echarts` — Apache ECharts; `chartjs` — Chart.js
4). A fifth candidate, `vue-chrts` (`nuxt-charts`), was evaluated as
droppable-if-budget-runs-short in the plan and was dropped — see the
spike doc §4 for why.

---

## Options considered

| Option | Capability score | Bundle delta (gzip) | Defects found |
|---|---|---|---|
| `svg` (incumbent) | 8/9 (fails #3) | +12.5 kB | 1 (unfixed — capability 3 itself) |
| `unovis` (designated baseline) | 5/9 pass, 4/9 partial | +77.5 kB | 3, one unresolved (dead tooltip) |
| `echarts` | 9/9 | +189.4 kB | 2, both fixed |
| `chartjs` | 9/9 | +80.5 kB | 2, both fixed |

(`vue-chrts` — not built; see above.)

---

## Decision

**Keep the incumbent hand-rolled SVG. Do not migrate.** File a small,
separate follow-up to fix its one real gap — capability 3, solid-past /
dashed-future segments on a single line — using the same two-path technique
every challenger in this spike needed anyway (a past-segment path and a
future-segment path, split at `todayIndex`, sharing one series). That is a
contained change to `app/lib/burndown.ts` and `BurndownChart.vue`, not a
rewrite.

**The designated baseline does not clear its bar.** The issue asks that
leaving `@unovis/vue` + the shadcn-vue chassis be justified, not assumed.
This spike found three genuine, browser-confirmed defects in it — a
`VisScatter` component that silently ignores its own `data` prop and
renders the whole container's row set instead (worked around, but a defect
in the primitive itself), dark-mode label colours that stay wrong because
Unovis's own built-in dark-mode CSS selectors don't match this app's actual
dark-mode convention, and a tooltip built exactly to the chassis's own
documented pattern that never becomes visible at all. None of that is
disqualifying on its own, but together they mean the "designated" position
does not, on inspection, hold up better than either the incumbent or either
challenger. It is not the winner and it is not the runner-up.

**Neither challenger's win is large enough to justify the migration.**
`echarts` and `chartjs` both reached a clean 9/9 — genuinely the strongest
capability scores in this spike, including the one capability (#3) the
incumbent fails. But every capability either challenger adds beyond what the
incumbent already has costs real, non-zero bundle weight (+189.4 kB or
+80.5 kB gzip, against a ~301 kB gzip baseline — 25–63% growth) for a chart
that, once capability 3 is patched, does everything the issue asks for
already, on infrastructure that ships today, is unit-tested, and needs no
new dependency at all.

---

## Consequences

- A small follow-up issue: give `BurndownChart.vue`'s line a solid-past /
  dashed-future split at `todayIndex`, mirroring the two-path technique used
  by every challenger candidate in this spike. Estimated small — the
  scaffolding (`todayIndex`, per-series colour, the geometry helpers in
  `burndown.ts`) already exists.
- No new production dependency. `@unovis/vue`, `@unovis/ts`, `echarts`,
  `vue-echarts`, `chart.js`, `vue-chartjs`, and `chartjs-plugin-annotation`
  are all removed from `package.json` in this branch's P8 commit — see
  "Reverting this decision" below for how to get them back.
- The dashboard spec correction (issue #10's F1: shadcn-vue does ship a
  `chart` registry item) stands regardless of this decision and is not
  reverted by P8 — it is a factual correction to a stale sentence, not part
  of the bake-off's dependency footprint.
- If a future screen needs a chart the incumbent's geometry genuinely can't
  express (a stacked area, a bar chart, a zoomable/pannable view), this
  document's evaluation of `echarts` and `chartjs` is the place to start —
  both are fully viable, and the "strongest argument against" below is
  really the argument for revisiting this decision at that point.

### Reverting this decision

Every candidate's code is preserved, just gated out. Commit `9fdc73b` — the
one landing `docs/spikes/chart-library-bakeoff.md` and this record, on
`spike/chart-library-bakeoff`, immediately before the P8 dependency-pruning
commit — is the last point at which all four candidates render with
`RUNWAY_LAB=all`. Revert the P8 commit (or check out `9fdc73b`) to bring
every candidate's dependencies and pages back.

---

## The strongest argument against this

**Chart.js should have won, and the incumbent's continued existence is
accumulating debt this decision chooses not to pay down.**

`chartjs` scored a clean 9/9, including the one thing the incumbent
outright fails. Its `segment.borderDash` callback is the only primitive in
this entire spike — the incumbent included — that does solid-past/dashed-
future on a *single* line rather than needing two. Its tooltip and click
handling worked against Chart.js's own native APIs on the first attempt,
with no fighting required, in contrast to every other non-incumbent
candidate. Its bundle cost, +80.5 kB gzip, is a fraction of what a mobile
user already downloads for the rest of the app, and its whole new dependency
stack is MIT — the cleanest license profile of any candidate, `svg`
excepted.

Every feature this chart will ever need past what it has today — a proper
zoom or pan, a second chart type, richer annotations, better hit-testing
under a stylus or a screen reader — is *easier* to build on Chart.js's
mature, widely-used primitives than by continuing to hand-extend
`app/lib/burndown.ts`'s bespoke pixel geometry. That geometry is already 293
lines and growing; every capability this bake-off found the incumbent
missing (and the ones it will inevitably miss next, that no one has asked
for yet) is more lines in a file only this codebase's own engineers ever
touch, instead of a battle-tested library hundreds of thousands of other
projects also depend on and pressure-test. Choosing "keep the incumbent" is,
honestly, choosing to keep paying that maintenance cost indefinitely in
exchange for a small one-time saving today.

The counter to that counter — and the reason this decision still stands —
is that the maintenance cost is *known and bounded* (one geometry file, one
component, currently 822 lines total, currently correct on eight of nine
capabilities), while the migration cost is not: no challenger in this spike
was tested for keyboard navigation or screen-reader support at all, and the
incumbent's accessibility work (arrow-key day navigation, a live region, a
generated `role="img"` summary) is real, already-shipped, already-tested
functionality that a Chart.js migration would have to reproduce from
scratch on a `<canvas>` element, which has categorically weaker native
assistive-technology support than the SVG/HTML-overlay approach the
incumbent already uses. That is not a hypothetical gap this document is
choosing to ignore — it is a real, unquantified cost this spike did not
measure, named plainly in
`docs/spikes/chart-library-bakeoff.md` §7, and it is the reason "Chart.js
scored higher" is not, by itself, enough to justify the migration today.
