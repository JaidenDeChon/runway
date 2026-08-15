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
| `bun run typecheck` | `nuxt typecheck` (vue-tsc, covers `.vue` SFC templates) + `tsc -p tsconfig.domain.json` (isolated domain typecheck). CI-enforced. |
| `bun run test` | Run the full Vitest suite once. |
| `bun run test:unit` | Run the `unit` Vitest project (`app/lib/**`, `app/utils/**`, `domain/**`) — pure node, no Nuxt boot. CI-enforced. |
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

## CI

Every PR and every push to `main` runs, via GitHub Actions:

- **Lint, typecheck, test, build** — `bun run lint && bun run typecheck && bun run test:unit && bun run build`, in that order.
- **Trivy filesystem scan** — fails on HIGH/CRITICAL vulnerabilities or secrets.
- **Dependency review** — fails on high-severity advisories introduced by a PR's dependency changes.

## Deployment

`main` deploys to Netlify. Build configuration lives in [`netlify.toml`](./netlify.toml): the
build command runs `bun install --frozen-lockfile && bun run build`, publishing `dist/`.
