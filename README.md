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
bun run dev
```

Then open http://localhost:3000. No `.env` file is required for local development — see
[Environment variables](#environment-variables).

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

See [`.env.example`](./.env.example). As of this scaffold, the app reads **no** environment
variables — `bun install && bun run dev` works with no `.env` file at all. When a feature starts
reading a variable, it is added to `.env.example` in the same change, even if commented out.

`.env` and `.env.*` are git-ignored, except `.env.example`, which is tracked.

## Project structure

```
app/            Nuxt 4 app directory (pages, layouts, components, composables, lib)
  lib/          App-level TypeScript, e.g. app/lib/navigation.ts (nav single source of truth)
  components/
    ui/         shadcn-vue vendor components — see "Adding a shadcn-vue component" below
domain/         Pure business logic. No Nuxt/Vue/Supabase/Node dependency — see domain/README.md
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
