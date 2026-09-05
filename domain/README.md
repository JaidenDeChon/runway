# `domain/`

Pure business logic for Runway, with no dependency on the Nuxt app, Vue, Supabase, or Node's
runtime APIs.

## Contract

- **Framework-free.** No `nuxt`, `#app`, `#imports`, `vue`, `vue-router`, `@lucide/*`,
  `@supabase/*`, or `node:*` imports. No imports of app code either (`~/*`, `@/*`, `#shared/*`) —
  dependencies only flow one way, from the app into the domain, never back.
- **Runtime-agnostic.** Anything in here must run unmodified in the browser, in Nitro's server
  runtime, in a plain Node script, or in a future non-Nuxt consumer.
- **Imported from Nuxt code as `~~/domain/<module>`.** The `~~` alias resolves to the repo root
  and needs no extra Nuxt config.
- **Typechecked in isolation** by `tsconfig.domain.json`, which sets `"types": []` — the domain
  must compile with no ambient Nuxt/Vue/Node types available.
- **Enforced by Biome.** The `domain/**` override in `biome.json` turns
  `style/noRestrictedImports` on for exactly the import list above; a violation is a lint error,
  not a review comment.
- **Tested with Vitest's `unit` project**, `environment: 'node'`, glob `domain/**/*.test.ts` — no
  Nuxt boot required to run these tests.

## What lives here

- `money.ts` — integer minor-units money helpers (issue #1's seed file, so this directory has at
  least one real module).
- `types.ts` — the data model. `dates.ts` — calendar-day arithmetic, including `todayIn`, the one
  place a timezone means anything. `cadence.ts` — expanding a rule into the days it lands on.
- `projection.ts` — the engine itself: `project`, `evaluate`, `shortfallThrough`, `upcomingBills`.
- `discretionary.ts` — the monthly discretionary figure divided by the length of the month each day
  falls in, with the remainder distributed so a month costs exactly what the user said it costs.
- `overrides.ts` — occurrence-level edits. `prediction.ts` — income predicted from deposit history.
  `accounts.ts`, `transfers.ts` — invariants over those collections. `seed.ts` — the synthetic
  fixture the app boots with, mirrored by `supabase/seed.sql`.
- `materialization.ts` — the desired set of materialized `public.occurrences` rows for a sliding
  window (`materializationWindow`, `desiredOccurrences`), expanded through `cadence.ts`'s
  `occurrenceDates` so there is exactly one implementation of cadence expansion. It computes the
  set; a database RPC applies it, guarding user-touched rows — see `docs/database/schema.md`.
- `fixtures/` — the golden scenarios and their committed output. See `fixtures/README.md`.

**Start at `docs/engine/README.md`**: the public API with worked examples, the rules that are easy
to get wrong (as-of anchoring, transfer neutrality, `verdictFrom`), the performance budget, and how
the whole thing is tested.
