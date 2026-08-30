-- Accounts gain an archive column, user_settings gains a per-user staleness
-- threshold, and archiving an account clears its discretionary designation.
--
-- Purely additive: public.accounts and public.user_settings already exist
-- (20260819171405_core_domain_schema.sql), already carry `enable row level
-- security`, the authenticated-only grant, and all four `(select auth.uid())`
-- policies (lines 302-314 and 358-370 of that file). No new table, therefore
-- no new policy and no new grant. `accounts` already has
-- `accounts_user_id_id_key unique (user_id, id)`, which is its RLS-predicate
-- index — this migration does not add a second one, and does not add a
-- partial index on archived_on either: a household has single-digit accounts
-- and the planner will never care. See docs/database/rls.md's checklist.

-- 1. The archive column.
alter table public.accounts
  add column archived_on date;

comment on column public.accounts.archived_on is
  'The calendar day this account was archived; null while it is active. Archived accounts keep every row that references them and contribute nothing to a projection.';

-- 2. The staleness threshold.
--
-- Why date, not timestamptz: everything the domain reads is a calendar day
-- (CLAUDE.md, domain/dates.ts), the value is written from the user's own
-- `today` exactly as balance_as_of is, and a timestamptz-to-calendar-day
-- conversion would need a timezone the mapping edge has no business owning.
-- updated_at already records the instant of the change, so nothing is lost.
--
-- Default 14: two weeks is about how long a hand-typed balance goes on
-- describing today for an ordinary household. Bounds 1..365 are a sanity
-- range in the same spirit as default_horizon_days' 1..730 — see "The horizon
-- is not a menu" in docs/database/schema.md.
alter table public.user_settings
  add column balance_stale_after_days smallint not null default 14
    check (balance_stale_after_days between 1 and 365);

comment on column public.user_settings.balance_stale_after_days is
  'How old a manually-typed balance anchor may get before the accounts screen flags it. A sanity range, not a menu — see default_horizon_days.';

-- 3. Archiving the discretionary source clears the designation, structurally.
--
-- user_settings.discretionary_account_id already has `on delete set null
-- (discretionary_account_id)`, so a *deleted* account cannot go on being the
-- source. Archiving is not a delete, so the same invariant needs its own
-- enforcement — and an invariant a reader has to remember is not an invariant
-- (docs/database/schema.md). The application clears it too; this makes
-- forgetting impossible.
--
-- `private`, because EXECUTE on new functions in `public` is revoked from
-- PUBLIC by 20260817020810 and a function in `public` is reachable through
-- PostgREST. SECURITY INVOKER (the default, stated for the reader): the caller
-- is `authenticated` and `user_settings_update_own` allows them to update their
-- own row, so no elevated privilege is needed. `set search_path = ''` with every
-- name schema-qualified.
create or replace function private.clear_discretionary_source_on_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.user_settings
     set discretionary_account_id = null
   where user_id = new.user_id
     and discretionary_account_id = new.id;
  return null;
end;
$$;

comment on function private.clear_discretionary_source_on_archive() is
  'Clears user_settings.discretionary_account_id when the account holding it is archived.';

revoke all on function private.clear_discretionary_source_on_archive() from public;

-- `after`, not `before`, and `returns null` — the return value of an AFTER row
-- trigger is ignored, so returning `null` states that it changes nothing about
-- the row it fired for.
create trigger accounts_clear_discretionary_source_on_archive
  after update of archived_on on public.accounts
  for each row
  when (new.archived_on is not null and old.archived_on is null)
  execute function private.clear_discretionary_source_on_archive();
