-- Runway: deny-by-default posture for the `public` schema.
--
-- This migration MUST remain first. It installs two independent layers:
--
--   1. PRIVILEGES. `anon` and `authenticated` are stripped of everything in
--      `public`, and ALTER DEFAULT PRIVILEGES stops them inheriting anything on
--      objects created later by `postgres` (the role migrations run as). A table
--      created without an explicit GRANT is unreachable through the Data API --
--      PostgREST answers 404 PGRST205 because it is not in that role's schema
--      cache at all.
--
--   2. RLS. An event trigger enables and forces row level security on every new
--      table in `public`. RLS on with no policy denies every row.
--
-- Layer 1 is the load-bearing one. Layer 2 exists so that the moment somebody
-- writes a GRANT, the rows stay closed until a policy opens them.
--
-- DO NOT replay this file by hand against a database that already holds domain
-- tables: the blanket REVOKE below would strip the explicit grants those tables'
-- own migrations issued. Supabase applies each migration exactly once, in
-- filename order. To rebuild, use `supabase db reset`.

-- ---------------------------------------------------------------------------
-- A private schema for infrastructure that must never be reachable from the API.
-- It is absent from `[api] schemas` in config.toml, so PostgREST cannot see it.
-- This is also the correct home for any future SECURITY DEFINER helper.
-- ---------------------------------------------------------------------------
create schema if not exists private;

revoke all on schema private from anon, authenticated;
grant usage on schema private to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Layer 1a: strip whatever anon/authenticated hold on `public` today.
--
-- On a fresh database this is a no-op, because `public` is empty. It matters on
-- the hosted project, where it removes privileges from anything created through
-- the dashboard before this migration landed.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Layer 1b: stop FUTURE objects inheriting anything.
--
-- Default privileges are recorded per creating role. Migrations, `supabase db
-- reset` and the Studio SQL editor all run as `postgres`, so `postgres` is the
-- role that matters. `supabase_admin`'s defaults cannot be altered from here
-- (postgres is not a superuser) and do not govern anything we create.
--
-- The last statement closes a Postgres default that is easy to miss: EXECUTE on
-- every new function is granted to PUBLIC, which is what silently turns a
-- SECURITY DEFINER function in `public` into an unauthenticated API endpoint.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Layer 2: force RLS on every new table in `public`.
--
-- SECURITY INVOKER (the default) on purpose. The role running CREATE TABLE owns
-- the resulting table and can therefore ALTER it, so no elevated privilege is
-- required and the SECURITY DEFINER bypass trap is avoided outright.
--
-- FORCE ROW LEVEL SECURITY also subjects the table owner to policies. Roles with
-- BYPASSRLS (`postgres`, `service_role`) still bypass, so migrations, the seed
-- and server-side admin access are unaffected.
-- ---------------------------------------------------------------------------
create or replace function private.force_rls_on_new_public_tables()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
  loop
    -- `in_extension` skips tables an extension owns; those are not ours to gate.
    if cmd.object_type = 'table'
       and cmd.schema_name = 'public'
       and not cmd.in_extension
    then
      execute format('alter table %s enable row level security', cmd.object_identity);
      execute format('alter table %s force row level security', cmd.object_identity);
    end if;
  end loop;
end;
$$;

revoke all on function private.force_rls_on_new_public_tables() from public;

-- Creating an event trigger needs a privilege the hosted `postgres` role may not
-- have. If it is refused, the push must not fail: layer 1 still stands, every
-- table migration enables RLS explicitly anyway, and the `rls` test project
-- asserts the invariant either way. plpgsql's EXCEPTION block is an implicit
-- subtransaction, so a failed CREATE also rolls back the DROP above it.
do $$
begin
  drop event trigger if exists force_rls_on_public_tables;

  create event trigger force_rls_on_public_tables
    on ddl_command_end
    when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    execute function private.force_rls_on_new_public_tables();
exception
  when insufficient_privilege then
    raise warning
      'runway: could not create event trigger force_rls_on_public_tables (%). Layer 1 (revoked privileges + default privileges) still applies; every table must enable RLS explicitly.',
      sqlerrm;
end
$$;
