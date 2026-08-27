-- Every account gets its settings row the moment it exists.
--
-- `public.user_settings` is one row per user, structurally: `user_id` is the
-- primary key. Before this migration nothing created that row, so a brand-new
-- account had no cushion, no horizon and no discretionary figure — not
-- *defaults*, but *absent*. Every reader downstream would then have to answer
-- "what if there is no settings row", and each would answer it slightly
-- differently, in application code, where the column defaults declared right
-- there in the schema could not help.
--
-- Creating it at the same instant as the user makes the row's existence an
-- invariant instead of a question. The column defaults — 60000, 0, 30 — are
-- what a new user gets, which is what they were written for.
--
-- ── Why a trigger, and not the application ───────────────────────────────────
--
-- Sign-up happens in GoTrue, not in this app: the browser posts to
-- `/auth/v1/signup` and the row in `auth.users` appears without any Nitro
-- handler running. There is no application code path to hang this on. Even if
-- there were, a second one exists — an invite from the dashboard, an admin
-- create, a future social provider — and each would need its own copy.
--
-- ── Why it lives in `private` ────────────────────────────────────────────────
--
-- `20260817020810_deny_by_default_privileges.sql` revokes EXECUTE on new
-- functions in `public` from PUBLIC precisely because a SECURITY DEFINER
-- function in `public` is an unauthenticated endpoint: PostgREST exposes it,
-- and this one runs as its owner. `private` is absent from `[api] schemas`, so
-- it is not reachable through the Data API at all. The EXECUTE revocation below
-- is belt and braces on top of that.
--
-- SECURITY DEFINER is required rather than convenient: the insert happens
-- inside GoTrue's transaction, under whatever role GoTrue holds, which has no
-- privilege on `public.user_settings` — and `user_settings` carries RLS with
-- policies written for `authenticated`, a role nobody is at the moment their
-- account is being created.
--
-- `set search_path = ''` with every name schema-qualified: without it, a
-- search_path the caller controls decides which `user_settings` this writes to,
-- which on a SECURITY DEFINER function is the classic privilege escalation.

create or replace function private.create_user_settings_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ON CONFLICT DO NOTHING, not because a conflict is expected in production,
  -- but because supabase/seed.sql inserts auth.users and then its own
  -- user_settings rows for the three seed users. Without this the trigger would
  -- win the race and the seed's insert would fail on the primary key; with it,
  -- the seed's own upsert supersedes these defaults. A local `db reset` is not
  -- a place to discover an ordering dependency.
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function private.create_user_settings_for_new_user() is
  'Creates the one public.user_settings row every account must have. Fired from auth.users.';

revoke all on function private.create_user_settings_for_new_user() from public;

-- AFTER, not BEFORE: `user_settings.user_id` is a foreign key to `auth.users`,
-- so the row it references has to exist before the insert is attempted.
create trigger on_auth_user_created_create_settings
  after insert on auth.users
  for each row
  execute function private.create_user_settings_for_new_user();
