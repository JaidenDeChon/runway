# Testing

Four suites, three runners, one rule: a suite that can pass without having
checked anything is worse than no suite, because it gets mistaken for evidence.

| Suite | Command | Needs | Proves |
| --- | --- | --- | --- |
| Unit | `bun run test:unit` | nothing | Pure logic — the projection engine, money, dates, `app/lib`, plus `tests/guards/` (source-reading structural guards, e.g. "only one file may write `public.occurrences`"). |
| Integration | `bun run test:integration` | local Supabase | RLS, tenancy, migrations, money at the storage boundary, the harness itself. |
| RLS (a subset of integration) | `bun run test:rls` | local Supabase | Just the security posture — see [`database/rls.md`](./database/rls.md). |
| E2E | `bun run test:e2e` | a browser **and** Supabase | Real user flows through the running app. |

`bun run test` runs every Vitest project — unit and integration. E2E has its own
runner and is not part of it.

---

## Quickstart

```sh
bun install

# Unit only. Nothing else required.
bun run test:unit

# Integration. Needs Docker.
bun run db:start
bun run test:integration

# E2E. Downloads Chromium the first time. Needs the stack up (above) and the
# app pointed at it — every route is behind sign-in, so every spec signs in.
bun run test:e2e:install
bun run test:e2e
```

Since issue #6 the E2E suite needs the local stack for **every** spec, not only
the authenticated-session one: the app has no unauthenticated screen to drive
except sign-in itself. The suite also needs the app configured — copy the local
stack's URL and publishable key from `supabase status` into `.env` as
`NUXT_PUBLIC_SUPABASE_URL` and `NUXT_PUBLIC_SUPABASE_ANON_KEY`. CI does the same
thing in a step of its own; see `.github/workflows/ci.yml`.

---

## The integration suite

Lives in `tests/rls/` and `tests/integration/`, which are **one Vitest project**
(`integration`) sharing `tests/support/`. They are not split because they share
seed users, clients, an admin connection and a stack; two projects would mean
two copies of all of that and two answers to "which user is A".

### It cannot be pointed at the hosted database

This is a requirement, not a convention, and it is enforced in one place:
`tests/support/stack.ts`. Every endpoint the suite resolves — whether from
`supabase status` or from the `RUNWAY_RLS_*` environment variables the global
setup publishes — is checked to be on loopback before anything connects. A
hosted host fails the run with a message naming it.

The environment-variable path is the one that mattered. Those variables exist so
each worker skips its own `supabase status` subprocess, and nothing used to
check them coming back in: exporting `RUNWAY_RLS_API_URL=https://<ref>.supabase.co`
was enough to aim the whole suite — including the negative control, which
deliberately widens an RLS policy — at production.

`tests/integration/local-only.test.ts` tests the guard rather than the current
configuration, and needs no database to do it.

### It never logs a secret

No error raised by the stack resolver interpolates a URL, because a database URL
is a connection string with a password in it. Failures name the *host*. CI's
failure diagnostics run `docker ps`, deliberately not `supabase status`, which
prints the stack's keys.

### Auth contexts

`tests/support/auth.ts` provides the four callers, each answering the same
question the same way:

| Context | Is |
| --- | --- |
| `validUserContext()` | Seed user A, signed in. |
| `secondUserContext()` | Seed user B — the one whose rows A must never see. |
| `unauthenticatedContext()` | The anon key and nothing else. |
| `expiredSessionContext()` | A correctly-signed token that has already expired. |

Each carries a `restSelect` that talks to PostgREST over plain `fetch` with
headers it sets itself, rather than through `supabase-js`. That is deliberate:
the library decides for itself when to attach a session and when to fall back to
the anon key, and an "unauthenticated reads nothing" test that had silently
become an "anon key reads nothing" test would still be green.

The expired context is the only one that cannot be obtained by signing in —
local `jwt_expiry` is an hour — so it is minted from the local stack's signing
secret (`tests/support/jwt.ts`). That secret is a published constant of the
CLI's local stack, worth nothing off your machine, never read from `.env`, and
never printed. It is *verified* before use by minting a valid token and checking
the API accepts it, so a wrong secret degrades to a loud failure and never to a
test that passes for the wrong reason.

### Seed helpers

`tests/support/fixtures.ts` writes households built from `domain/types.ts` —
`createSeedData()` is a ready-made one — **through PostgREST under a user's own
session**, never over the admin connection. Seeding is therefore itself an
exercise of the INSERT policies, and a fixture cannot exist that the application
could not have created. Occurrences are expanded by the engine's own
`occurrenceDates`, not by a second implementation.

Rows are named `fixture:<label>:<name>` and removed by that prefix, so a run
that dies mid-test leaves debris the next one sweeps.

It deliberately does not touch `user_settings`: there is one row per user, and
`tests/rls/seed-fidelity.test.ts` asserts that users A and C still mirror
`domain/seed.ts` exactly.

### The budget

The whole integration project is held to a wall-clock budget, enforced in the
global setup's teardown (`tests/support/global-setup.ts`). It runs on every pull
request; that is the constraint it is held to. Override with
`RUNWAY_INTEGRATION_BUDGET_MS` while bisecting something slow, and change the
default deliberately, with a reason, rather than because it went red.

### Skipping, and when skipping is banned

With the stack down, the database files skip themselves and say why, so someone
without Docker still gets a green `bun run test`. In CI that would be a green
run proving nothing, so the `database` job sets `RUNWAY_RLS_REQUIRE_STACK=1` and
a missing stack becomes a hard failure. Set it locally for the same strictness:

```sh
RUNWAY_RLS_REQUIRE_STACK=1 bun run test
```

---

## The E2E suite

`tests/e2e/`, run by Playwright (`playwright.config.ts`). Two projects, both
Chromium: a desktop viewport and a 375px one, because `CLAUDE.md` says every
screen is built at 375px first and a harness that only drove desktop would let
that rot unobserved.

Playwright starts the app itself (`webServer`), against a **production
preview** — `bun run build && bun run preview` — not the Nuxt dev server. It
started as dev and moved: the dev server compiles routes lazily, and on a cold
CI runner with no `.nuxt` cache it did not become ready inside 180s, so the
whole job failed without running a test while passing locally on a warm cache.
The preview server serves an already-built Nitro output, is listening in
seconds, and exercises what actually ships. CI builds in an explicit step and
overrides the command with `RUNWAY_E2E_SERVER_COMMAND=bun run preview`, so a
compile error is reported as a failed build rather than as a server that never
came up. See the header of `playwright.config.ts` for the long form.

Traces, screenshots and video are kept **on failure only** and uploaded as CI
artifacts. They contain rendered page content, which for this app means
balances, so they are never echoed into the log and never committed.

### The authenticated-session fixture, and the empty household beside it

The fixture signs in against the local GoTrue as a seed user and installs the
resulting session as cookies, under the names `@supabase/ssr` chose — obtained
by handing a real server client a recording cookie adapter and asking it, never
guessed. It then proves the token works by reading that user's rows through
PostgREST before any test uses it.

**The application reads the database now.** `app/composables/useRunwayData.ts`
reads `accounts` and `user_settings` from Supabase behind the seam (issue #7);
`tests/e2e/authenticated-session.spec.ts`'s once-`test.fixme` is a real test
that inserts a row through PostgREST under a session and then asserts the UI
shows it, which is the assertion "the fixture works" always meant to make.

That test, and every other E2E spec that writes an account, run as **user
D** — `tests/e2e/fixtures.ts`'s `emptyHouseholdSession` /
`emptyHouseholdPage` — rather than the seeded user A. D's household is empty
by design and reset before and after each use, precisely so a write-heavy
spec cannot accumulate rows against a user `tests/rls/seed-fidelity.test.ts`
holds to an exact fixture.

### Expected failures are annotated, not deleted

A test for behaviour that is currently broken is marked `test.fail()`, which
runs it and fails the suite if it ever *passes*. That is the point: when the bug
is fixed, CI tells whoever fixed it to remove the annotation. `test.fixme` is
for what cannot run at all yet.

---

## CI

| Job | Runs |
| --- | --- |
| `Lint, typecheck, test, build` | Biome, all four tsconfigs, `test:unit`, `nuxt build`. No database. |
| `Migrations, generated types, RLS` | Brings a stack up from nothing, checks generated types are fresh, runs `bun run test` with skipping banned. |
| `E2E (Playwright)` | Stack up, Chromium installed, `bun run test:e2e`, report uploaded on failure. |
| `Trivy vulnerability scan` | Dependencies and secrets. |

`supabase start` in those jobs applies every migration to an empty database and
loads the seed, so **migration-from-zero is proven on every pull request** before
a test runs. `tests/integration/migrations.test.ts` then asserts the running
database is exactly what the migrations produce and nothing else.

> **These jobs do not block merge on their own.** Requiring a status check is a
> repository setting, not something a workflow file can assert. See the pull
> request for the exact check names to add under branch protection.

---

## Typechecking

Four configs, and the split is meaningful rather than bureaucratic:

| Config | Covers | Why separate |
| --- | --- | --- |
| Nuxt's generated one | `app/` | `vue-tsc`, covers SFC templates. |
| `tsconfig.domain.json` | `domain/` | `"types": []` — the engine must compile with no ambient Nuxt/Vue/Node types. |
| `tsconfig.tests.json` | `tests/**` except `tests/e2e/`, plus `domain/**/*.test.ts` | Node libs, **no DOM** — a node test that can see `window` will eventually reach for it. |
| `tsconfig.e2e.json` | `tests/e2e/`, `tests/support/`, `playwright.config.ts` | E2E genuinely runs in a browser; `page.evaluate` touches `window` by definition. |

`bun run typecheck` runs all four.
