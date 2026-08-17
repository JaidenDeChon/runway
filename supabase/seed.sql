-- Runway local seed. Runs automatically after migrations on `supabase db reset`
-- (see `[db.seed]` in supabase/config.toml). `supabase db push` never sends this
-- file, and it must never be run against the hosted project.
--
-- Everything here is synthetic. No real balances, no real people, no real
-- institution data — ever. See docs/database/local-development.md.
--
-- Two users exist because the RLS suite must prove that user A cannot read user
-- B's rows. Their ids are pinned constants so tests and future seed data can
-- reference them directly:
--
--   user A  00000000-0000-4000-8000-00000000000a  user-a@runway.test / runway-local-a
--   user B  00000000-0000-4000-8000-00000000000b  user-b@runway.test / runway-local-b
--
-- These passwords are local-only fixtures with no value outside this machine.
--
-- ISSUE #3: add accounts / recurring_rules / occurrences / transfers /
-- user_settings rows at the bottom of this file, owned by these same two ids.
-- Do not invent new users.

-- Idempotent: makes the file safe to replay by hand. On a fresh reset this is a
-- no-op. The FK cascade clears dependent rows.
delete from auth.users
where id in (
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b'
);

-- The empty-string token columns are not decoration: gotrue scans them into Go
-- strings and errors on NULL. `extensions.crypt` is pgcrypto, which the Supabase
-- image installs into the `extensions` schema, not `public`.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token,
  is_super_admin, is_sso_user, is_anonymous
)
values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-00000000000a',
   'authenticated', 'authenticated',
   'user-a@runway.test',
   extensions.crypt('runway-local-a', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', '', '', '',
   false, false, false),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-8000-00000000000b',
   'authenticated', 'authenticated',
   'user-b@runway.test',
   extensions.crypt('runway-local-b', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', '', '', '',
   false, false, false);

-- Without a matching identity row, password sign-in fails.
insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(), now(), now()
from auth.users u
where u.id in (
  '00000000-0000-4000-8000-00000000000a',
  '00000000-0000-4000-8000-00000000000b'
);

-- Fixture rows for the RLS suite: two owned by A, one by B. The suite asserts
-- ownership predicates, never exact counts, so issue #3 can add rows freely.
insert into public.rls_fixture_items (user_id, label) values
  ('00000000-0000-4000-8000-00000000000a', 'user a item 1'),
  ('00000000-0000-4000-8000-00000000000a', 'user a item 2'),
  ('00000000-0000-4000-8000-00000000000b', 'user b item 1');
