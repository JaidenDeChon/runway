# Chart library bake-off

Issue [#10](https://github.com/JaidenDeChon/runway/issues/10). Branch
`spike/chart-library-bakeoff`. Disposition: **hold for review** — this spike
was never self-merged; the deliverable is the decision recorded in
[`docs/decisions/0001-chart-library.md`](../decisions/0001-chart-library.md).

This document is the evidence. The decision, and the strongest argument
against it, live in the ADR — read that first if you only have five minutes.

---

## 1. What this answers, and how

The question: which library draws Runway's burndown chart. Every candidate
below renders **the same fixed dataset** —
`createShortSeedData()` projected at `SEED_TODAY` (`domain/seed.ts`), no
hand-written `RecurringItem` literals anywhere in this spike — through the
same `project()` call, computed once in `app/lab/chart-bakeoff/fixture.ts`.
Nothing here performs arithmetic on a balance; every number comes out of the
domain engine.

### Two privileged candidates, not five equals

The issue itself sets up an asymmetric comparison, and this report keeps it
asymmetric rather than flattening it into a five-way scorecard:

- **`svg` is the incumbent.** `app/components/dashboard/BurndownChart.vue`
  (529 lines) and `app/lib/burndown.ts` (293 lines, unit-tested geometry)
  ship in production today. It already implements most of the nine
  capabilities below, including keyboard navigation and a `role="img"`
  summary sentence that no other candidate in this spike was even attempted
  for. It holds **possession** — replacing it is work that has to pay for
  itself.
- **`unovis` is the designated baseline.** The issue is explicit that
  `@unovis/vue`, drawn inside the shadcn-vue `chart` registry item's chassis,
  is the design-system's own answer, and that leaving it needs
  justification. This report gives that justification, in detail, below.

`echarts` and `chartjs` are challengers to both. Neither gets to win by
beating a flat average — each has to clear the incumbent's bar and the
baseline's bar on its own.

### Re-running this yourself

```sh
RUNWAY_LAB=all bun run dev
```

Then open `/lab/chart-bakeoff`. Each candidate page carries a 375px/full-width
toggle and a light/dark toggle (`CandidateFrame.vue`) — the 375px gate is
judged in a real bordered container, not a screenshot, because the repo's
rule against committing rendered-balance images is absolute and this makes
screenshots unnecessary. No screenshot is committed anywhere in this spike.

To reproduce the bundle numbers: `bun scripts/bakeoff-bundle.ts` (six real
`nuxt build` runs at the time of writing four candidates were live; it
re-discovers candidates from `app/pages/lab/chart-bakeoff/*.vue`, so it stays
correct after P8 prunes the losers).

---

## 2. The nine capabilities

From the issue, reproduced here as the checklist every candidate page and
`app/lab/chart-bakeoff/capabilities.ts` use verbatim:

1. Multi-series line with per-series color from theme tokens
2. A labeled horizontal reference line (the cushion) with shaded region below
3. Visually distinct solid past segments and dashed future segments on the
   same line
4. Event markers on specific dates
5. A highlighted, labeled minimum point
6. Crosshair or tooltip with custom itemized content
7. Click on a data point returning that point's identity
8. **Legible at 375px width — a pass/fail gate, not a score.** A candidate
   that fails it is disqualified regardless of how it does on the other
   eight, and this document uses that word rather than averaging it in.
9. Correct rendering in light and dark themes

Every verdict below was written from something actually observed on a running
candidate page — clicking, resizing to 375px, flipping the theme — never from
a library's documentation. Several verdicts exist specifically *because* a
verdict written from documentation would have been wrong (see §4).

---

## 3. The capability matrix

`pass` / `partial` / `fail`, transcribed verbatim from
`app/lab/chart-bakeoff/candidates.ts` — the same object the in-browser
scorecard renders, so this table and the running page cannot disagree.

| # | Capability | `svg` (incumbent) | `unovis` (baseline) | `echarts` | `chartjs` |
|---|---|---|---|---|---|
| 1 | Multi-series, per-series token colour | pass | pass | pass | pass |
| 2 | Cushion reference line + shaded band | pass | pass | pass | pass |
| 3 | Solid past / dashed future, one line | **fail** | pass | pass | pass |
| 4 | Event markers on specific dates | pass | partial | pass | pass |
| 5 | Highlighted, labeled minimum point | pass | partial | pass | pass |
| 6 | Tooltip/crosshair, itemized content | pass | partial | pass | pass |
| 7 | Click → point identity | pass | pass | pass | pass |
| 8 | **Legible at 375px (GATE)** | pass | pass | pass | pass |
| 9 | Correct in light + dark | pass | partial | pass | pass |

No candidate failed the 375px gate. Four of nine capabilities are pass/pass
across the whole field; the field only actually splits on three things: the
incumbent's one real gap (#3), and the baseline's three genuine defects
(#4, #5, #6, plus a partial on #9) that no challenger reproduced.

`echarts` and `chartjs` are the only two candidates with a clean 9/9 —
neither has an unresolved defect by the end of this spike (each needed two
real bugs fixed along the way; see §4).

---

## 4. Per-candidate notes

### `svg` — the incumbent

Unmodified. `app/pages/lab/chart-bakeoff/svg.vue` imports
`BurndownChart.vue` and feeds it the shared fixture; nothing under
`app/components/dashboard/` changed.

**The one real gap.** `dashArrayFor()` in `burndown.ts` dashes a line by its
**series index** — so overlapping accounts can be told apart — not by date.
There is a vertical "Today" marker, but the line itself never switches from
solid to dashed at today. Capability 3 asks for exactly that switch on one
line, and this component does not do it. This is a genuine fail, not a
technicality: reading the rendered chart, a viewer cannot tell forecast from
history by the line alone.

**What already works better than expected.** Multi-series colouring, the
cushion band, event markers, the itemized tooltip (confirmed: hovering shows
"Aug 28 · Checking $617 · Savings $45 · Combined $662"), and click identity
(confirmed: returns "Aug 14, 2026") all pass cleanly. The one caveat under
the 375px gate: the "Lowest" text label can run past the frame's right edge
when the low point falls late in the window — the marker itself stays
visible and the label is present in the DOM, reachable by scrolling, so this
does not fail the gate, but it is a real rough edge worth naming.

**What this component has that no challenger in this spike was tested for:**
keyboard navigation across days, a live region announcing the active day's
balances, and a `role="img"` summary sentence. Building those against a
canvas-rendered chart (`echarts`, `chartjs`) is real work with no native
equivalent; `unovis` renders real SVG/DOM so it is more plausible there, but
none of it was attempted in this spike — see §6.

### `unovis` — the designated baseline

`bunx shadcn-vue@latest add chart` installed the registry item unmodified
(`app/components/ui/chart/`); `@unovis/vue` + `@unovis/ts` draw inside it.
This confirms the plan's F1 finding: the chassis is real chrome
(`ChartContainer`/`ChartStyle`/`ChartTooltipContent`) around Unovis doing the
actual drawing, ported from shadcn/ui's React original — its CSS still
carries a pile of dead `.recharts-*` selectors that match nothing in a
Vue/Unovis app (harmless, just noise; see §5 for the one place that noise
actually reached a compiled stylesheet).

Three genuine defects surfaced from driving the page, not from reading docs:

1. **`VisScatter`'s own `data` prop is not honoured per-component.** A
   scatter bound to a verified one-row computed rendered all 45 of the
   container's rows instead of the one it was given — confirmed by
   isolating a single scatter and checking the computed's reactive value
   directly with a temporary `watchEffect` before removing it. `VisLine`,
   in the same file, respects the same kind of override correctly; this is
   specific to `VisScatter`. Every scatter in `UnovisChart.vue` (event
   markers, the minimum-point marker, the click hit-layer) works around it
   by staying bound to the container's own row set and returning `undefined`
   from its own accessor for the rows it doesn't want — `undefined`/`NaN`
   is confirmed to drop a point cleanly. This is a real, load-bearing defect:
   any integration needing a scatter *subset* — which is exactly what
   capabilities 4 and 5 ask for — hits it.
2. **Unovis's own dark-mode CSS selectors don't match this app's dark mode.**
   `unovis/ts/utils/theme.js` ships `html.dark-theme`,
   `html[data-theme="dark"]`, and similar — this app's actual dark mode is a
   bare `.dark` class (`@nuxtjs/color-mode`, `classSuffix: ''`). Nothing in
   Unovis's own defaults ever matches, so any label colour left on an Unovis
   default (e.g. `--vis-plotline-label-color`) stays near-black and is
   nearly illegible against a dark surface. Every label in
   `UnovisChart.vue` sets `label-color` explicitly to work around this.
3. **The chassis's own documented tooltip pattern doesn't produce a visible
   tooltip.** `componentToString` + `ChartTooltipContent` — the pattern
   `chart/utils.ts` ships specifically for this — was wired exactly as
   documented. The crosshair itself tracks the pointer correctly (its
   indicator circles land on the right series at the right x, confirmed
   visually), but no populated tooltip node ever appears in the DOM on
   hover; `document.body`'s tooltip element stays `display: none` with
   empty `innerHTML`. Root cause not confirmed within this spike's budget.
   `componentToString` is also the source of the SSR hydration mismatch
   below — the same function misbehaving twice is more likely one bug than
   two, but that is not confirmed either.

**A genuine SSR hydration mismatch, every page load.** `componentToString`
calls Reka UI's `useId()` only when `isClient` is true — meaning it is
skipped entirely during server rendering and called during client hydration,
which shifts every `useId()` call after it by one and desyncs
`ChartStyle`'s generated id between server and client. Vue logs a hydration
text-mismatch warning on first paint. The page recovers (Vue reconciles to
the client render), but it is a real defect in the chassis, not a
theoretical one — reproduced on every full page load throughout this spike.

**What worked cleanly, and is genuinely nice:** `VisPlotline` +
`VisPlotband` are purpose-built for the cushion line and danger band — less
code than the incumbent needed for the same thing. Two `VisLine` layers
sharing one container gave a clean solid/dashed split (composition, not a
single-line primitive, but it works). `ChartStyle`'s scoped `--color-<key>`
mechanism is a genuinely good idea for the multi-series colouring problem.
Click identity works once wired to the same "bind the whole container, hide
what you don't want" pattern the scatter defect forced elsewhere.

### `echarts` — Apache ECharts

`vue-echarts` imported directly, **not** the `nuxt-echarts` module — a
deviation from the plan's dependency table, made per the plan's own stated
fallback: a Nuxt module registers and runs at build/server-init time
regardless of which page ends up using it, which is exactly the property
`RUNWAY_LAB` exists to prevent. Confirmed the production build stays clean
(§5) either way.

Renders to `<canvas>`, so every colour is resolved with `getComputedStyle`
and re-resolved on a `colorMode.value` watcher — a `var()` cannot resolve
against a canvas fillStyle the way it can against an SVG attribute, because
there is no element for the custom property to inherit through. This is the
shape the plan's risk table predicted for a canvas library, and it held up
exactly as predicted.

Two real bugs surfaced and were fixed, not left broken:

1. `tooltip: { show: false }` on the dashed "future" half of a split line —
   intended only to keep a duplicate row out of the legend — also removes
   that series from the axis-triggered tooltip's `params` entirely. Hovering
   the future half of any line showed an empty tooltip. Fixed by removing
   the flag and de-duplicating by series name inside the formatter instead
   (the only genuine duplicate is the single index exactly at `todayIndex`,
   where past and future both include the boundary point).
2. Hovering blurs every series not at the exact hovered index by default,
   which reads as the past half of every line disappearing on hover. Fixed
   with `emphasis: { disabled: true }` on every series.

After both fixes: itemized tooltip content, correct in both themes,
confirmed in the browser (`Aug 29, 2026 · Checking $597 · Savings $45 ·
Combined $642`). Click returns a real date (`Aug 22, 2026`) via
`params.name`, which is the category axis's own ISO string — no decoding
needed. `markLine`/`markArea` gave the cushion line and danger band for less
code than the incumbent needed. No unresolved defect.

### `chartjs` — Chart.js 4

`vue-chartjs`'s `<Line>` plus `chartjs-plugin-annotation` for the reference
line and danger band — Chart.js core has no reference-line primitive at all,
so that dependency is real, counted cost, not incidental. Same canvas /
`getComputedStyle` reasoning as `echarts` applies here too.

Two real bugs, both fixed and commented in `ChartJsChart.vue`:

1. `chartjs-plugin-annotation` registered only through the per-instance
   `:plugins` prop throws (`Cannot set properties of undefined (setting
   'backgroundColor')`) — it merges its own options into
   `Chart.defaults.plugins.annotation`, which only exists once
   `Chart.register()` has run globally. Fixed by registering it globally
   alongside the rest of Chart.js's components, same as the documented
   usage.
2. A per-point `pointRadius` array (0 everywhere except event days and the
   lowest point) still gets Chart.js's *fixed* default hover radius and
   colour on top of it, popping a stray default-black dot onto an otherwise
   invisible point the instant the pointer approaches it. Fixed by mirroring
   `pointHoverRadius` / `pointHoverBackgroundColor` /
   `pointHoverBorderColor` onto the same per-point arrays.

**The one native win in this whole spike.** Chart.js's `segment.borderDash`
callback is the only primitive, anywhere in this bake-off — incumbent
included — that does capability 3 on a *single* dataset. Every other
candidate, the incumbent included, needed two lines (a past one and a future
one) to get a solid-to-dashed transition. Tooltip (itemized, correct
content) and click identity (`options.onClick`, `elements[0].index` maps
straight to the fixture's day array) both worked against Chart.js's native
APIs on the first attempt, no fighting required. No unresolved defect.

### `vue-chrts` — dropped

Not built. Per the plan's own risk table: `nuxt-charts` self-describes as a
"Nuxt module for vue-chrts (legacy Unovis engine)" — a convenience layer
over the same rendering engine already exercised in full as candidate
`unovis`, making it the least informative candidate to spend further budget
on. P0–P4 involved substantially more real debugging than planned for
(three genuine `unovis` defects, two `echarts` bugs, two `chartjs` bugs, all
load-bearing findings), which is exactly the "budget runs short" case the
plan names. Four candidates — the incumbent, the designated baseline, and
two independent challengers — is what got evaluated, and the plan is
explicit that four still satisfies the issue.

---

## 5. Bundle size — measured, not estimated

`scripts/bakeoff-bundle.ts`, N+1 real `nuxt build` runs, client output only
(`.output/public/_nuxt/`, every `.js`/`.css`, raw and gzipped via
`zlib.gzipSync`). Raw numbers in
`.claude/runway-runner/tasks/10/bundle-sizes.json` (git-ignored working
data; re-run the script to reproduce).

| Candidate | Raw delta | Gzip delta | `node_modules` (own packages, secondary — see below) |
|---|---|---|---|
| `svg` | +27.6 kB | +12.5 kB | — (no new dependency) |
| `unovis` | +246.0 kB | +77.5 kB | 10.8 MB |
| `echarts` | +558.6 kB | +189.4 kB | 59.3 MB |
| `chartjs` | +230.3 kB | +80.5 kB | 6.3 MB |

Baseline (`RUNWAY_LAB=0`): 999.7 kB raw / 301.1 kB gzip, 64 files. Every
delta above is against that baseline.

**Verification step 4's grep, run for real:** `RUNWAY_LAB=0 bun run build`,
then `grep -rl "vue-echarts\|zrender\|@unovis\|chart\.js\|chartjs-plugin"
.output/` — zero matches. A production build ships none of the four
libraries built in this spike. (`grep -rl "echarts"` alone gives one false
positive — Tailwind's utility-class scanner compiles the shadcn `chart`
chassis's dead `.recharts-*` selectors into the global stylesheet
regardless of whether any page imports the component, since content
scanning is file-based and does not know about `pages:extend`. That is real,
if minor — CSS bytes, not JS — and is exactly why the grep above matches on
the real package names, not a substring of "recharts.")

**The headline number this measurement exists to produce.** `@unovis/ts`
declares `three`, `elkjs`, `leaflet` and `maplibre-gl` as runtime
dependencies — full 3D, graph-layout, and two separate mapping engines, for
what ships as a line chart. That is ~73 MB combined in `node_modules` (the
"secondary" column above). The plan's risk table predicted this might sink
the candidate on its own weight. It measures at **+246.0 kB raw / +77.5 kB
gzip** in the actual client bundle — Vite's tree-shaking removes the unused
3D/map/graph-layout code before it ever reaches the browser. That is a
measured result, not the assumption the plan explicitly warned against
defaulting to. `unovis`'s defects (§4) are real; its bundle weight,
measured, is not one of them.

`echarts` is the heaviest of the three challengers by a wide margin even
after `vue-echarts`'s own tree-shaken import path (`echarts/core` +
individual chart/component/renderer modules, not the full library) —
consistent with it being the most fully-featured of the three off the shelf.
`chartjs` is the lightest challenger in both raw and gzip terms, and its
`node_modules` footprint (6.3 MB, all three packages combined) is an order
of magnitude below `echarts`'s.

---

## 6. License — verified from installed `node_modules`

Every row below was read from the actually-installed package's own
`package.json`, not from a registry page or this table re-typed from memory.

| Package | Installed version | License |
|---|---|---|
| `@unovis/vue` | 1.6.7 | Apache-2.0 |
| `@unovis/ts` | 1.6.7 | Apache-2.0 |
| `echarts` | 6.1.0 | Apache-2.0 |
| `vue-echarts` | 8.2.0 | MIT |
| `chart.js` | 4.5.1 | MIT |
| `vue-chartjs` | 5.3.4 | MIT |
| `chartjs-plugin-annotation` | 3.1.0 | MIT |

All permissive. None copyleft, none source-available-with-restrictions.
`chartjs` is the only candidate whose entire new dependency stack is MIT —
`unovis` and `echarts` each carry an Apache-2.0 package, which is still
permissive but carries a NOTICE-file attribution obligation MIT does not.

---

## 7. What this spike did not test

Named plainly rather than left implicit:

- **No challenger's keyboard navigation or screen-reader support was built
  or tested.** The incumbent has both (arrow-key day navigation, a live
  region, `role="img"`); this spike did not attempt to reproduce either on
  any challenger. A production migration would need to build and verify
  this from scratch — see the ADR's "strongest argument against."
- **`unovis`'s dead tooltip and its `VisScatter` data-override defect are
  not root-caused**, only isolated and worked around. Both are worth a
  minimal upstream reproduction if anyone revisits `@unovis/vue`.
- **No suite beyond `bun run lint`, `bun run typecheck`, and
  `bun run test:unit` was run against this spike's own code**, and none was
  implied to have run. This spike touches no database and adds no
  user-facing route to the shipped app, so `test:integration`, `test:rls`,
  and `test:e2e` were not run and are not relevant to it.
