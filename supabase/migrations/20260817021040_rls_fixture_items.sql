-- Runway: `rls_fixture_items` — an infrastructure fixture, NOT a domain table.
--
-- It exists for exactly one reason: the RLS suite needs a user_id-scoped table
-- with rows in it to prove that (a) an unauthenticated client reads nothing,
-- (b) user A cannot reach user B's rows, and (c) loosening a policy makes those
-- assertions fail. The real domain tables — accounts, recurring_rules,
-- occurrences, transfers, user_settings — belong to issue #3. This table is
-- deliberately content-free so nobody mistakes it for one of them.
--
-- It is also the worked example behind docs/database/rls.md. Copy this file,
-- not your memory of it.
--
-- Rows are seeded locally by supabase/seed.sql and never exist on the hosted
-- project. Issue #3 may drop this table in a follow-up migration once the domain
-- tables carry the same assertions.

create table public.rls_fixture_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);

-- Written explicitly even though the event trigger from the previous migration
-- already did it. Redundant locally, essential if that trigger was refused on a
-- hosted push, and it keeps the canonical pattern self-contained.
alter table public.rls_fixture_items enable row level security;

-- Required twice over: user_id is the RLS predicate column AND a foreign key.
-- An unindexed RLS predicate turns every policy check into a sequential scan.
create index rls_fixture_items_user_id_idx on public.rls_fixture_items (user_id);

-- Privileges are opt-in (see the previous migration). `anon` is granted nothing
-- at all, so an unauthenticated request never reaches the policy layer.
grant select, insert, update, delete on public.rls_fixture_items to authenticated;

create policy rls_fixture_items_select_own
  on public.rls_fixture_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy rls_fixture_items_insert_own
  on public.rls_fixture_items
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy rls_fixture_items_update_own
  on public.rls_fixture_items
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy rls_fixture_items_delete_own
  on public.rls_fixture_items
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
