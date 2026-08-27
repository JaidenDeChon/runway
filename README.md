# Runway

Runway is a personal cash-flow app: a shared shell for tracking accounts, recurring items,
transfers, and whether you'll make it to your next payday, built with Nuxt 4, Vue 3, Tailwind 4
and shadcn-vue.

## Prerequisites

- [Bun](https://bun.sh) `1.3.0`
- Node `22.13.0` (used by tooling that shells out to Node; Bun runs the app itself)

## Quickstart

```bash
git clone git@github.com:JaidenDeChon/runway.git
cd runway
bun install
bun run db:start     # the local Supabase stack — needs Docker
# then point the app at it, per docs/database/local-development.md
bun run dev
```

Then open http://localhost:3000 and sign in as a seed user — `user-a@runway.test` /
`runway-local-a`. Every route is behind sign-in ([`docs/auth.md`](./docs/auth.md)), so the app needs
`NUXT_PUBLIC_SUPABASE_URL` and `NUXT_PUBLIC_SUPABASE_ANON_KEY` in a `.env` — see
[Environment variables](#environment-variables) and
[`docs/database/local-development.md`](./docs/database/local-development.md) for the copy-paste
command that reads them out of the running stack.

## Scripts

| Script | What it does |
|---|---|
| `bun run dev` | Start the Nuxt dev server. |
| `bun run build` | Production build (Nitro `node-server` preset). |
| `bun run generate` | Static site generation. |
| `bun run preview` | Preview a production build locally. |
| `bun run lint` | Biome, check mode (`biome ci .`). CI-enforced. |
| `bun run lint:fix` | Biome, write mode — fixes lint issues and formatting. |
| `bun run format` | Biome, format-only write mode. |
| `bun run typecheck` | All four tsconfigs: `nuxt typecheck` (SFC templates), `tsconfig.domain.json` (isolated domain), `tsconfig.tests.json` (node tests), `tsconfig.e2e.json` (browser tests). CI-enforced. |
| `bun run test` | Run every Vitest project once (unit + integration). |
| `bun run test:unit` | The `unit` project (`app/lib/**`, `app/utils/**`, `domain/**`) — pure node, no Nuxt boot. CI-enforced. |
| `bun run test:integration` | The `integration` project against a local Supabase stack. CI-enforced. |
| `bun run test:rls` | Just the RLS files — a subset of `test:integration`. |
| `bun run test:e2e` | Playwright, against the running app. CI-enforced. |
| `bun run test:e2e:install` | Download the Chromium build Playwright needs (once per machine). |
| `bun run test:e2e:ui` | Playwright's interactive UI mode. |
| `bun run test:watch` | Vitest in watch mode. |
| `bun run ui:add <component>` | Add a shadcn-vue component (`shadcn-vue add <component>`). |

## Environment variables

See [`.env.example`](./.env.example). The app reads two, both public and both required since
authentication landed: `NUXT_PUBLIC_SUPABASE_URL` and `NUXT_PUBLIC_SUPABASE_ANON_KEY`. Without them
it fails at boot with an error naming both, rather than serving a sign-in form that can never work.

They resolve at **runtime**, not build time — nothing in `nuxt.config.ts` reads `process.env` — which
is what lets a deploy target change them without a rebuild. Every variable the app reads is listed in
`.env.example` in the same change that starts reading it.

The test suites need none of it: they read the local stack's credentials from `supabase status` and
refuse any endpoint that is not on loopback.

`.env` and `.env.*` are git-ignored, except `.env.example`, which is tracked.

## Project structure

```
app/            Nuxt 4 app directory (pages, layouts, components, composables, lib)
  lib/          App-level TypeScript, e.g. app/lib/navigation.ts (nav single source of truth)
  components/
    ui/         shadcn-vue vendor components — see "Adding a shadcn-vue component" below
  middleware/   Route middleware. auth.global.ts is the door on every route.
  plugins/      supabase.{client,server}.ts — the session, one per tab / per request
domain/         Pure business logic. No Nuxt/Vue/Supabase/Node dependency — see domain/README.md
shared/         Code both halves import (`#shared/...`): generated DB types, the auth utilities
server/         Nitro. middleware/auth.ts validates the session; utils/supabase.ts is requireUser()
supabase/       Migrations, config and the local seed — see docs/database/
tests/
  support/      Shared test plumbing: stack resolution, auth contexts, seed helpers, assertions
  domain/       Tests *about* the domain that cannot live inside it (purity, benchmark)
  rls/          Security-posture tests against a live local database
  integration/  Data-layer and harness tests against a live local database
  e2e/          Playwright specs driving the running app
```

### The `app/` vs `domain/` boundary

`domain/` holds framework-free, runtime-agnostic business logic (money math today; the data model,
projection engine, and occurrence materialization from later issues land here too). The boundary
is machine-enforced, not just documented, by three independent mechanisms:

1. **Import path.** Nuxt code imports domain modules as `~~/domain/<module>` (the `~~` alias
   resolves to the repo root; no extra Nuxt config needed).
2. **Isolated typecheck.** `tsconfig.domain.json` sets `"types": []`, so `domain/` must compile
   with no ambient Nuxt/Vue/Node types available. Run standalone via
   `bunx tsc -p tsconfig.domain.json`, or as part of `bun run typecheck`.
3. **Lint enforcement.** `biome.json` has a `domain/**` override that turns on
   `style/noRestrictedImports` for Nuxt, Vue, Supabase, `node:*`, and app-code (`~/*`, `@/*`)
   imports — importing any of them inside `domain/` is a lint error.

## Adding a shadcn-vue component

```bash
bun run ui:add <component>
```

This installs into `app/components/ui/<component>/`. That directory is vendor code: it is
excluded from Biome entirely (regenerating it would otherwise churn on every `add`), and it is
**not** auto-registered as global components — import it explicitly from `@/components/ui/*`.

## Theming

Design tokens (including the `--chart-1`..`--chart-5` chart palette) live in
`app/assets/css/tailwind.css`, defined for both `:root` and `.dark`. The theme toggle lives in the
header, next to the breadcrumb. Dark mode is powered by `@nuxtjs/color-mode`, which injects a
pre-paint inline script into the SSR HTML so `.dark` lands on `<html>` before first paint — no
flash, no hydration mismatch.

## Testing

Full guide: [`docs/testing.md`](./docs/testing.md). The short version:

```bash
bun run test:unit                       # pure logic, needs nothing

bun run db:start                        # needs Docker
bun run test:integration                # RLS, tenancy, migrations, money at the boundary

bun run test:e2e:install                # once per machine
bun run test:e2e                        # real user flows through the running app
```

The E2E suite needs the local stack **and** a `.env` pointing the app at it: every route is behind
sign-in, so every spec signs in.

Two things worth knowing before you touch any of it:

- **The integration and E2E suites cannot be pointed at the hosted database.**
  Every endpoint is checked to be on loopback before anything connects — including
  values arriving through environment variables. See `tests/support/stack.ts`.
- **A skipped suite is not a passing one.** With the local stack down, the
  database tests skip themselves so `bun run test` stays green without Docker. CI
  sets `RUNWAY_RLS_REQUIRE_STACK=1`, which turns a missing stack into a hard
  failure.

## CI

Every PR and every push to `main` runs, via GitHub Actions:

- **Lint, typecheck, test, build** — `bun run lint && bun run typecheck && bun run test:unit && bun run build`, in that order.
- **Migrations, generated types, RLS** — brings a Supabase stack up from nothing (which is what proves every migration applies from zero), checks the generated types are not stale, and runs the full Vitest suite with skipping banned.
- **E2E (Playwright)** — runs the browser suite against the app, uploading traces and screenshots for anything that failed.
- **Trivy filesystem scan** — fails on HIGH/CRITICAL vulnerabilities or secrets.
- **Dependency review** — fails on high-severity advisories introduced by a PR's dependency changes.

Note that a workflow cannot make itself required: blocking merge on these is a
branch-protection setting a repository admin has to add.

## Deployment

`main` deploys to Netlify. Build configuration lives in [`netlify.toml`](./netlify.toml): the
build command runs `bun install --frozen-lockfile && bun run build`, publishing `dist/`.

The two `NUXT_PUBLIC_SUPABASE_*` variables must be set on the site (Site configuration →
Environment variables). They are read at runtime, so changing them needs no rebuild — and a deploy
without them serves a 500 rather than a broken sign-in page.
[`docs/auth.md`](./docs/auth.md) lists what else a hosted Supabase project needs configured:
redirect allow-list, SMTP, email confirmation, templates, password policy, and the migrations.
