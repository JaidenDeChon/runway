# Design Reference

Design artifacts produced in Claude Design, committed here so coding agents and humans can reference them during implementation.

**This directory is a reference, not a source.** Nothing here is imported, built, or deployed.

---

## Directory layout

```
docs/design/
  README.md                    ← this file
  <screen-slug>/
    spec.md                    ← the written specification (read this first)
    screens/
      <state>.png              ← one image per state
    reference.html             ← standalone export, for lookup only
```

One directory per screen. Slugs match the ones in the issue tracker.

---

## The three artifacts

### `spec.md` — read this first, every time

The written specification: component inventory by shadcn name, layout structure, every state, interaction behavior, and any decisions that aren't visible in a screenshot. Cheap in context and the highest-signal artifact here.

If `spec.md` and a screenshot disagree, `spec.md` wins. If `spec.md` is silent on something, the screenshot decides.

### `screens/*.png` — for verification

One image per state, not just the happy path. Use these to answer "does my implementation match?" — a question that can't be answered from prose alone.

### `reference.html` — for lookup only

The standalone Claude Design export. Open it to resolve a specific ambiguity: an exact spacing value, a border treatment, a hover state the spec didn't describe.

**Do not read it start to finish and do not port its markup.** It was generated in whatever framework was fastest for the design tool and is very likely React. This project is Vue 3 with `shadcn-vue`. Translating that markup is explicitly not the workflow — it produces code shaped by a prototype's throwaway structure instead of by this codebase's conventions.

---

## Tokens

**The repo is the source of truth for all design tokens.** Colors, typography, spacing, radii, and the `--chart-1` through `--chart-5` chart series colors live in the Tailwind config and CSS variables.

Nothing in this directory restates a token value. If a spec mentions a color, it names the token, never a hex value. A second copy of the palette in `docs/` will drift from the real one and then get believed.

If a design artifact appears to use a value that doesn't exist in the token set, that's a discrepancy to raise — not a value to hardcode.

---

## Screen index

| Screen | Slug | Related issues | Status |
|---|---|---|---|
| Burndown dashboard | `dashboard` | Burndown chart, Dashboard | ☑ |
| Will I make it | `shortfall` | Shortfall calculator | ☑ |
| Occurrence editor | `occurrence-editor` | Occurrence editor, What-if mode | ☐ |
| Accounts | `accounts` | Accounts management | ☑ |
| Recurring items | `recurring-items` | Recurring items, Income prediction | ☑ |
| First run | `first-run` | First-run experience | ☑ |
| Sign in / sign up / password reset | `auth` | Authentication | ☐ |

The `occurrence-editor` row is unticked because that screen does not exist in the Claude Design
project — there is no export to import.

The `auth` row is unticked for a different reason, and it is worth stating plainly: **those screens
shipped without a design.** Issue #6 (Authentication) landed sign-in, sign-up, password reset and
the emailed-link error page, and there was no `docs/design/auth/` to build them against. They were
built from this repo's own conventions instead — the `max-w-[480px]` column and wordmark from
`onboarding.vue`, `shadcn-vue` Card / Input / Label / Button / Tabs, tokens only, no hardcoded
values — and `app/layouts/auth.vue` says so in its own comment. Nothing was invented from a
screenshot, because there was no screenshot. If a design lands later, treat what is there as a
placeholder to replace rather than as a decision to preserve.

Tick a box when the screen's artifacts land. Screens are exported as they're designed, not in one batch — a partially populated directory with an accurate index is more useful than an empty one waiting on a big export.

---

## Adding a screen

1. Create `docs/design/<slug>/`.
2. Ask Claude Design for the written specification and save it as `spec.md`. Ask explicitly — it doesn't produce this by default. Request: shadcn component inventory, layout structure, all states, interaction behavior, and any non-obvious spacing or token decisions.
3. Export each state as a PNG into `screens/`. Name by state: `default.png`, `empty.png`, `loading.png`, `shortfall.png`, `negative.png`.
4. Export standalone HTML as `reference.html`.
5. Tick the row in the index above.
6. Update the related issues to point at the directory path.

---

## Deviating from the design

Deviations get raised, not silently resolved.

If the design can't be implemented as specified — a `shadcn-vue` component behaves differently from its React counterpart, the chart library can't produce a treatment, an interaction doesn't survive contact with real data — say so in the PR and describe what was done instead. Don't quietly substitute something close.

Accessibility is the exception that overrides the design without discussion: if an artifact specifies contrast, touch target sizing, or focus behavior below standard, implement to standard and note it.

---

## What isn't here

- Component source code — that's `shadcn-vue`, installed via CLI
- Token definitions — Tailwind config and CSS variables
- Any real financial data. Every figure in every artifact is synthetic.
