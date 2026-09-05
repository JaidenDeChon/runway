# Runway — agent guide

`CLAUDE.md` and `AGENTS.md` are kept identical. Edit both, or neither.

---

## What Runway is, and where it runs

Runway answers one question: *given what is coming, when does my balance dip
lowest, and does it clear my cushion?* Every screen is a view onto `domain/`'s
projection of that.

**Sign-in has landed, and accounts, recurring items and their materialized
occurrences have followed it onto Supabase.** Every route is behind a
Supabase session (`docs/auth.md`), the server validates that session rather
than trusting the client, `user_id` is derived from it and never from a
request, and issue #7 moved `/accounts` and `/first-run`'s account step onto
real `public.accounts` and `public.user_settings` rows, issue #8 moved
`/recurring-items` onto real `public.recurring_rules` rows, and issue #9 keeps
`public.occurrences` reconciled with those rules through
`public.regenerate_occurrences` — all behind the `useRunwayData` seam.
Transfers are the last session-local `useState` records, held in memory and
lost on reload, and start **empty** rather than from `domain/seed.ts` — a
seeded transfer's `accountId` would dangle against account ids the database
never held. Issue #56 owns folding transfers into ordinary transactions.
`domain/seed.ts` is now a fixture the tests and the local database's seed
build from, not something the running app ever reads.

That remains explicitly *not* a call for browser-local persistence. Anything
reaching for `localStorage` to hold user data should be a Supabase call — and
now there **is** a session to make it under. `useSupabaseClient()` in a
component, `serverSupabaseClient(event)` plus `requireUser(event)` in a Nitro
handler.

**The rest of Supabase was built ahead of the app needing it**, deliberately.
The schema, the deny-by-default RLS posture and the migrations are built and
tested (`docs/database/`) so that moving a screen onto real rows is a change of
*storage* rather than a redesign.

What that means while writing code:

- **The domain shapes map to the schema one-to-one, on purpose.** `RunwayData`
  is what `user_settings` and the user's rows will deserialize into. Add a field
  to one and you add it to the other, and to the mapping table in
  `docs/database/schema.md`. A field that exists only in memory is a field that
  gets lost the day sign-in ships.
- **`app/composables/useRunwayData.ts` is the seam.** It holds all state and
  every mutation. Putting Supabase behind it should mean changing that file
  and nothing downstream of it, so screens must not reach around it.
- **Authentication is a seam too, and it is already closed.** Read
  `docs/auth.md` before touching a route, a session, or anything that needs to
  know who the user is. Two rules from it are absolute: a handler learns the
  caller from `requireUser(event)` and never from a request parameter, and a
  message shown to a signed-out visitor comes from `#shared/auth/errors` so it
  cannot reveal whether an email address is registered.
- **Per-user isolation is already the model.** Every domain table carries
  `user_id`; do not write code that assumes a single user just because there is
  currently exactly one.
- **Device-derived facts are not user data.** The browser's timezone, viewport
  and colour-scheme preference belong to the device and are re-derived there.
  What the *user* chose is data and gets stored. Keeping those apart is what
  lets the same account behave correctly on a second device.
- **No real financial data, ever.** Seeds and fixtures are synthetic, and that
  does not change when storage does.

---

## Design reference

Design artifacts live in `docs/design/<screen-slug>/`. The index is `docs/design/README.md`.

**Before implementing or modifying any UI:**

1. Read `docs/design/<slug>/spec.md`.
2. View the PNGs in `docs/design/<slug>/screens/` — including the non-default states, not just `default.png`.
3. Implement against those.

**`reference.html` is a visual reference, not a code source.** It is a generated prototype export, very likely React. This codebase is Vue 3 with `shadcn-vue`. Do not read it in full, do not port its markup, and do not translate its component structure. Open it only to resolve a specific ambiguity the spec and screenshots leave open.

**Tokens come from the repo, never from the design artifacts.** Colors, spacing, typography, radii, and `--chart-1` through `--chart-5` are defined in the Tailwind config and CSS variables. If a design appears to use a value with no corresponding token, raise it — do not hardcode it.

**Precedence when sources disagree:** `spec.md` beats the screenshots; the screenshots beat `reference.html`; the repo's tokens beat all three.

**Deviations get raised, not silently resolved.** If the design can't be built as specified, describe in the PR what was done instead and why. Accessibility standards override the design without discussion — implement to standard and note it.

If a screen has no directory under `docs/design/`, its design hasn't landed yet. Say so before proceeding rather than inventing an interface.

---

## Database

Docs live in `docs/database/`. Local workflow is `local-development.md`; the
security posture is `rls.md`; the shape itself is `schema.md`.

**Before creating or altering any table:** read `docs/database/rls.md` and copy
the canonical policy pattern. Do not improvise one. Every domain table carries
`user_id` referencing `auth.users`, enables RLS explicitly, indexes `user_id`,
grants `authenticated` (never `anon`), and gets four `to authenticated` policies
using `(select auth.uid())` — the subquery form, not bare `auth.uid()`.

- Migrations are forward-only and applied exactly once. Never edit one that has
  been pushed; write a new one.
- `shared/supabase/database.types.ts` is generated by `bun run db:types`. Never
  hand-edit it.
- The service-role key bypasses every policy. Server-only, never
  `NUXT_PUBLIC_*`, never imported under `app/`.
- Seeds and fixtures are synthetic. No real financial data, ever.
- `bun run test:rls` proves the posture holds. It needs the local stack up; a
  green `bun run test` with those tests skipped proves nothing.

---

## Projection engine

`domain/` is the pure calculation engine every screen is a view onto. Read
`docs/engine/README.md` before changing anything in it — the public API with
worked examples, and the rules that are easy to get wrong.

- **Pure and enforced.** No Nuxt, Supabase, network, filesystem or clock.
  `today` is a parameter. `tests/domain/purity.test.ts` reads the source and
  fails the build if that stops being true.
- **Integer minor units everywhere.** Not one floating-point monetary value.
- **Calendar days, never instants.** `YYYY-MM-DD`. `domain/dates.ts` `todayIn`
  is the only function in the domain where a timezone means anything.
- **One walk.** `project` computes the series, the running minimum and the
  closing balance in a single pass; `evaluate` reads that summary. If you are
  looping over points to find a minimum, the engine already found it.
- **Golden fixtures are load-bearing.** `bun run test:golden:update` regenerates
  `domain/fixtures/golden.json` — read the diff, and name the behaviour change
  that caused it in the commit. If you cannot, it is a bug.
- **The engine never logs.** A balance must not reach an application log.

## UI conventions

- Vue 3 with `<script setup>` and TypeScript, strict mode
- `shadcn-vue` components installed via CLI — do not hand-write a component that exists in the registry
- Tailwind utilities; no separate stylesheets except for token definitions
- Mobile-first: build at 375px, then adapt upward
- Both light and dark themes work, always
- Money is displayed from integer cents, formatted at the edge — never stored or passed as a float
- Components perform no financial calculation. All projection arithmetic comes from the engine. Arithmetic on balances inside a component is a bug.
- No balance values in logs, analytics events, or URL parameters

---

## Testing

Full guide: `docs/testing.md`. What an agent must not get wrong:

- **Four suites.** `bun run test:unit` (pure logic, needs nothing),
  `bun run test:integration` (live local Supabase), `bun run test:rls` (a subset
  of it), `bun run test:e2e` (Playwright against the running app). `bun run test`
  runs the Vitest projects — unit and integration — and not E2E.
- **Never point a suite at the hosted database.** Endpoints are resolved and
  loopback-checked in `tests/support/stack.ts`, including values arriving through
  `RUNWAY_RLS_*` environment variables. Do not add a second way to configure a
  connection, and do not weaken that guard to make something run.
- **A skipped suite is not a passing one.** The database tests skip themselves
  when the stack is down so `bun run test` stays green without Docker; CI sets
  `RUNWAY_RLS_REQUIRE_STACK=1` to ban that. If a test cannot run, make it fail
  loudly — do not substitute a weaker assertion under the same test name.
- **Seed fixtures go in through a user's own session**, never the admin
  connection, so seeding exercises the INSERT policies and cannot create rows the
  app could not. Build them from `domain/types.ts`; `tests/support/fixtures.ts`
  is the helper.
- **Never log a balance, a token or a connection string** — not in an assertion
  message, not in CI output. Errors name hosts, ids and counts.
- **Broken behaviour gets `test.fail()`, not deletion.** It runs, and the suite
  goes red when someone fixes the bug and forgets to remove the annotation.
  `test.fixme` is only for what cannot run at all yet.
- Playwright traces and screenshots contain rendered balances. They are failure-
  only CI artifacts; never commit them and never echo them into a log.
