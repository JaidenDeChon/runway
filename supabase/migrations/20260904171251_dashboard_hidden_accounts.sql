-- The dashboard's per-account chart visibility.
--
-- One row per account the user has unchecked in the chart legend. The stored
-- set is the HIDDEN one, never the shown one, so an account created on another
-- screen appears on the chart instead of silently missing from it — the same
-- reasoning app/pages/index.vue already carried in memory.
--
-- Why a table and not a uuid[] on user_settings: an array cannot carry the
-- composite foreign key that docs/database/schema.md's "Cross-user integrity"
-- makes the rule, so a row naming another user's account would be a policy
-- question rather than a structural impossibility, and a deleted account would
-- leave its id behind forever. Why not a boolean on accounts: it would put a
-- presentation preference on domain/types.ts Account, which is constructed in
-- the seed, the golden fixtures and the save_account RPC's signature.
--
-- No updated_at and no trigger: the row's existence IS the value. Hiding
-- inserts, showing deletes; nothing about a row is ever edited.
create table public.dashboard_hidden_accounts (
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, account_id),
  constraint dashboard_hidden_accounts_account_fk
    foreign key (user_id, account_id)
    references public.accounts (user_id, id) on delete cascade
);

comment on table public.dashboard_hidden_accounts is
  'Accounts the user has unchecked in the dashboard chart legend. Presence means hidden; absence means shown, so a new account is visible by default.';

-- Redundant locally (the event trigger in 20260817020810 already did it),
-- essential if that trigger was refused on a hosted push. Always written.
alter table public.dashboard_hidden_accounts enable row level security;

-- No separate user_id index: user_id is the leading column of the primary key,
-- so that index IS the RLS-predicate index. See docs/database/rls.md's
-- checklist, which names this case explicitly.

grant select, insert, update, delete on public.dashboard_hidden_accounts to authenticated;

create policy dashboard_hidden_accounts_select_own on public.dashboard_hidden_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy dashboard_hidden_accounts_insert_own on public.dashboard_hidden_accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy dashboard_hidden_accounts_update_own on public.dashboard_hidden_accounts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy dashboard_hidden_accounts_delete_own on public.dashboard_hidden_accounts
  for delete to authenticated using ((select auth.uid()) = user_id);
