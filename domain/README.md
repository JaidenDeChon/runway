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
- Issue #3 landed the rule window (`startsOn`/`endsOn`) and `annual` cadence on `RecurringItem`,
  plus `discretionary.ts`, which converts the schema's stored monthly discretionary figure into
  the flat daily rate `projection.ts` already drains.
- Issue #4 (projection engine) and #9 (occurrence materialization) land here too.
