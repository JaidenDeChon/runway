# Row Level Security — the canonical pattern

Runway holds financial data. Every table in `public` is closed to the API by
default, and the only thing that opens a row to a user is a policy that names
them explicitly.

This document exists so the pattern is copied rather than improvised. If you
are adding a table, you want [The pattern](#the-pattern) and
[The checklist](#the-checklist). Read the rest once.

---

## How "deny by default" is actually enforced

Enabling RLS on each table is necessary but not sufficient — it relies on
somebody remembering. `supabase/migrations/20260817020810_deny_by_default_privileges.sql`
installs two independent layers so that forgetting is not enough to open a
hole.

**Layer 1 — privileges.** `anon` and `authenticated` are stripped of every
privilege in `public`, and `ALTER DEFAULT PRIVILEGES` stops them inheriting
anything on objects created later. A table created with no explicit `GRANT` is
unreachable through the Data API regardless of its RLS state. This is the
load-bearing layer.

Postgres also grants `EXECUTE` on every new function to `PUBLIC`. That default
is revoked too — it is what silently turns a `SECURITY DEFINER` function in
`public` into an unauthenticated endpoint.

**Layer 2 — forced RLS.** An event trigger,
`private.force_rls_on_new_public_tables()`, runs `ENABLE` + `FORCE ROW LEVEL
SECURITY` on every new table in `public`. RLS on with no policy denies every
row. So the moment somebody writes a `GRANT`, the rows stay closed until a
policy opens them.

The trigger needs a privilege the hosted `postgres` role may not have. If the
`CREATE EVENT TRIGGER` is refused, the migration warns and continues — layer 1
still stands, and `tests/rls/deny-by-default.test.ts` asserts the invariant
either way. **Do not rely on layer 2 alone; always write `enable row level
security` explicitly in your migration.**

There is also a `private` schema, absent from `[api] schemas` in
`config.toml`. Anything that must never be reachable from the API — including
any future `SECURITY DEFINER` helper — belongs there, not in `public`.

---

## The pattern

Every domain table carries `user_id uuid not null references auth.users (id) on
delete cascade`, and gets four policies — one per command. Copy this verbatim
and substitute the table name:

```sql
create table public.example_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- ... your columns. Money is bigint cents. Calendar days are date, not timestamptz.
  created_at timestamptz not null default now()
);

-- Redundant locally (the event trigger already did it), essential if that
-- trigger was refused on a hosted push. Always write it.
alter table public.example_items enable row level security;

-- Required twice over: user_id is the RLS predicate column AND a foreign key.
create index example_items_user_id_idx on public.example_items (user_id);

-- Privileges are opt-in. `anon` is granted nothing, ever.
grant select, insert, update, delete on public.example_items to authenticated;

create policy example_items_select_own
  on public.example_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy example_items_insert_own
  on public.example_items
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy example_items_update_own
  on public.example_items
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy example_items_delete_own
  on public.example_items
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
```

The worked example is
`supabase/migrations/20260817021040_rls_fixture_items.sql`. Copy the file, not
your memory of it.

### Why each detail is the way it is

**`(select auth.uid())`, never bare `auth.uid()`.** Wrapping it in a subquery
lets the planner evaluate it once per statement (an InitPlan) instead of once
per row. On a table of any size the unwrapped form turns a policy check into a
per-row function call and the query falls off a cliff. This is the single most
common RLS performance mistake.

**`to authenticated`, never omitted.** A policy with no `TO` clause applies to
`PUBLIC`, which includes `anon`. Naming the role means the policy is not even
considered for an anonymous request.

**An index on `user_id`, always.** It is the RLS predicate on every query, and
separately it is a foreign key — an unindexed FK makes deletes on `auth.users`
scan the child table.

**Four policies, not one `for all`.** `FOR ALL` needs a `WITH CHECK` to be safe
on writes, and a single policy makes it easy to widen read access while
intending to widen writes. Separate policies fail loudly instead.

**`USING` and `WITH CHECK` are different things.** `USING` decides which
existing rows a statement can see; `WITH CHECK` decides what the resulting row
is allowed to look like. `UPDATE` needs both — `USING` alone would let a user
take a row they own and reassign its `user_id` to somebody else.

**`FORCE ROW LEVEL SECURITY`.** Applied by the event trigger. It subjects the
table owner to policies too. Roles with `BYPASSRLS` (`postgres`,
`service_role`) still bypass, so migrations, the seed, and server-side admin
access are unaffected.

---

## The checklist

For every new table:

- [ ] `user_id uuid not null references auth.users (id) on delete cascade`
- [ ] `alter table ... enable row level security` written explicitly
- [ ] `create index <table>_user_id_idx on ... (user_id)`
- [ ] If `user_id` is the primary key, or is the leading column of a unique constraint the table already carries (`unique (user_id, id)`), that index *is* the RLS-predicate index. Do not create a second one.
- [ ] `grant select, insert, update, delete ... to authenticated` — and nothing to `anon`
- [ ] Four policies, each `to authenticated`, each using `(select auth.uid())`
- [ ] `update` carries both `using` and `with check`
- [ ] Money columns are `bigint` cents; calendar dates are `date`
- [ ] Added to `supabase/seed.sql` under both seed users, so the RLS suite covers it
- [ ] `bun run db:types` re-run and the result committed
- [ ] `bun run test:integration` passes

---

## The service-role key

`service_role` holds `BYPASSRLS`. It ignores every policy in this document.

- It is server-only: `NUXT_SUPABASE_SERVICE_ROLE_KEY`, never `NUXT_PUBLIC_*`,
  never in `runtimeConfig.public`, never imported into anything under `app/`.
- No application code reads it yet. It is declared in `.env.example` so the
  boundary exists before something needs it.
- If you find yourself reaching for it to make a query work, the policy is
  wrong. Fix the policy.

---

## Proving it, rather than assuming it

`tests/rls/` runs against a live local database:

| File | Proves |
| --- | --- |
| `unauthenticated.test.ts` | An anonymous client reads nothing, writes nothing, and holds no privilege. |
| `cross-user-isolation.test.ts` | User A cannot read, update, delete, or plant rows belonging to user B. |
| `deny-by-default.test.ts` | Every table in `public` has RLS on; a brand-new table with no policy and no grant is unreachable; `private` is closed to API roles. |
| `negative-control.test.ts` | **The suite fails when a policy is loosened.** |

That last file is the one that makes the other three worth anything. It adds a
`using (true)` policy, asserts the isolation check now fails, and restores the
original. A suite that passes against a wide-open database is worse than no
suite, because it gets mistaken for evidence.

Run with `bun run test:rls` (needs the local stack up). The suite is also part
of `bun run test`, where it skips itself with a warning if the stack is down —
see [local-development.md](./local-development.md).

Two invariants of the test project, set in `vitest.config.ts`: `fileParallelism`
and `sequence.concurrent` are both **off**, because the negative control mutates
shared policy state. Do not turn them back on.
