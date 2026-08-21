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
-- Issue #3 added accounts / recurring_rules / occurrences / transfers /
-- user_settings rows at the bottom of this file, owned by these same two ids.
-- User A mirrors domain/seed.ts's Checking/Savings scenario, including the
-- Rent rule split (an August rule that ends, a September rule that starts) so
-- the seed and the domain module tell the same story. User B is a smaller but
-- non-empty scenario in every table, so the RLS suite has real cross-user rows
-- to probe. See docs/database/schema.md for the full shape.

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

-- ── issue #3: core domain schema ────────────────────────────────────────────
-- Ids are pinned v4-shaped UUID constants, grouped by table prefix
-- (10000000.. accounts, 20000000.. rules, 30000000.. transfers) with the
-- seeded user's id as the trailing hex digit, so the file stays
-- self-referencing and readable.

-- accounts
insert into public.accounts (id, user_id, name, color, balance_cents, balance_as_of) values
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a',
   'Checking', 'chart-3', 214000, '2026-08-15'),
  ('10000000-0000-4000-8001-00000000000a', '00000000-0000-4000-8000-00000000000a',
   'Savings', 'chart-4', 320000, '2026-08-15'),
  ('10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b',
   'B Checking', 'chart-2', 90000, '2026-08-15'),
  ('10000000-0000-4000-8001-00000000000b', '00000000-0000-4000-8000-00000000000b',
   'B Savings', 'chart-4', 150000, '2026-08-15');

-- user_settings — one row per user, discretionary source pinned to Checking.
insert into public.user_settings (
  user_id, cushion_cents, monthly_discretionary_cents, discretionary_account_id, default_horizon_days
) values
  ('00000000-0000-4000-8000-00000000000a', 60000, 103400,
   '10000000-0000-4000-8000-00000000000a', 30),
  ('00000000-0000-4000-8000-00000000000b', 30000, 50000,
   '10000000-0000-4000-8000-00000000000b', 60);

-- recurring_rules — every monthly anchor's day-of-month is <= 28, so
-- generate_series' sticky month-stepping below agrees with
-- domain/dates.ts addMonthsClamped, which is not sticky.
--
-- days_of_month is null on all but one rule, which is the point: null means
-- "the day anchor_date names". The exception is the semi-monthly salary, the
-- shape a large share of paychecks actually take — see docs/database/schema.md.
insert into public.recurring_rules (
  id, user_id, account_id, name, kind, amount_cents, amount_source, is_variable,
  cadence, anchor_date, starts_on, ends_on, days_of_month
) values
  ('20000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Car payment', 'bill', 31000, 'fixed', false,
   'monthly', '2026-08-20', null, null, null),
  ('20000000-0000-4000-8001-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Paycheck', 'income', 245000, 'predicted', false,
   'biweekly', '2026-08-21', null, null, null),
  ('20000000-0000-4000-8002-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Car insurance', 'bill', 17500, 'fixed', false,
   'monthly', '2026-08-24', null, null, null),
  ('20000000-0000-4000-8003-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Electric & water', 'bill', 14000, 'fixed', true,
   'monthly', '2026-08-28', null, null, null),
  ('20000000-0000-4000-8004-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8001-00000000000a', 'Side work', 'income', 40000, 'fixed', false,
   'monthly', '2026-08-27', null, null, null),
  ('20000000-0000-4000-8005-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Phone', 'bill', 5500, 'fixed', false,
   'monthly', '2026-09-03', null, null, null),
  ('20000000-0000-4000-8006-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8001-00000000000a', 'Streaming', 'bill', 1800, 'fixed', false,
   'monthly', '2026-09-08', null, null, null),
  -- The split pair: the August rule closes with ends_on, the September rule
  -- opens with starts_on == anchor_date. Apply-to-future is this split, never
  -- a bulk occurrence edit — see docs/database/schema.md.
  ('20000000-0000-4000-8007-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Rent', 'bill', 165000, 'fixed', false,
   'monthly', '2026-08-01', null, '2026-08-31', null),
  ('20000000-0000-4000-8008-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Rent', 'bill', 175000, 'fixed', false,
   'monthly', '2026-09-01', '2026-09-01', null, null),
  ('20000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b',
   '10000000-0000-4000-8000-00000000000b', 'B Rent', 'bill', 90000, 'fixed', false,
   'monthly', '2026-09-01', null, null, null),
  ('20000000-0000-4000-8001-00000000000b', '00000000-0000-4000-8000-00000000000b',
   '10000000-0000-4000-8000-00000000000b', 'B Paycheck', 'income', 120000, 'fixed', false,
   'biweekly', '2026-08-14', null, null, null),
  -- Semi-monthly, the 1st and the 15th. Written unsorted on purpose: the
  -- normalising trigger stores it as {1,15}, and `db:reset` failing to do that
  -- is something worth noticing here rather than in a projection.
  ('20000000-0000-4000-8009-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8001-00000000000a', 'Salary', 'income', 118000, 'fixed', false,
   'monthly', '2026-08-01', null, null, '{15,1}');

-- occurrences — materialized from every rule above, from its effective start
-- (anchor, or starts_on if later) through 2026-12-31.
insert into public.occurrences (user_id, account_id, rule_id, projected_date, projected_amount_cents)
select r.user_id, r.account_id, r.id, d::date,
       case when r.kind = 'income' then r.amount_cents else -r.amount_cents end
from public.recurring_rules r
cross join lateral generate_series(
  greatest(r.anchor_date, coalesce(r.starts_on, r.anchor_date))::timestamp,
  least(coalesce(r.ends_on, date '2026-12-31'), date '2026-12-31')::timestamp,
  case r.cadence
    when 'weekly'   then interval '7 days'
    when 'biweekly' then interval '14 days'
    when 'monthly'  then interval '1 month'
    when 'annual'   then interval '1 year'
  end
) as d
where r.days_of_month is null;

-- Day-set rules land on several days per month, so one series of month starts,
-- expanded by the days themselves. `least(..., month end)` is the clamp
-- domain/cadence.ts performs, and `distinct` collapses days that clamp onto the
-- same date — `occurrences` is unique on (rule_id, projected_date), so a
-- collision here would be an error rather than a duplicate row.
insert into public.occurrences (user_id, account_id, rule_id, projected_date, projected_amount_cents)
select distinct r.user_id, r.account_id, r.id, occurrence.occurs_on,
       case when r.kind = 'income' then r.amount_cents else -r.amount_cents end
from public.recurring_rules r
cross join lateral generate_series(
  date_trunc('month', greatest(r.anchor_date, coalesce(r.starts_on, r.anchor_date))),
  date_trunc('month', least(coalesce(r.ends_on, date '2026-12-31'), date '2026-12-31')),
  interval '1 month'
) as month_start
cross join lateral unnest(r.days_of_month) as wanted_day
cross join lateral (
  select case
    when wanted_day = -1 then (month_start + interval '1 month - 1 day')::date
    else least(
      month_start::date + (wanted_day - 1),
      (month_start + interval '1 month - 1 day')::date
    )
  end as occurs_on
) as occurrence
where r.days_of_month is not null
  and occurrence.occurs_on >= greatest(r.anchor_date, coalesce(r.starts_on, r.anchor_date))
  and occurrence.occurs_on <= least(coalesce(r.ends_on, date '2026-12-31'), date '2026-12-31');

-- occurrence state demonstrations — one of each of the three states, on dates
-- the generator above actually produced (verified by querying after
-- `db:reset`, not assumed):
--
--   confirmed : Electric & water's first generated occurrence, 2026-08-28.
--   overridden: Car payment's first generated occurrence, 2026-08-20 — status
--               stays 'projected', matching an edited-but-not-yet-happened
--               single instance.
--   skipped   : Streaming's second generated occurrence, 2026-10-08.
--
-- Always scoped by r.user_id and r.name together — rule names are not unique
-- across users.
update public.occurrences o
set status = 'confirmed', actual_amount_cents = -32100, actual_date = o.projected_date
from public.recurring_rules r
where r.id = o.rule_id
  and r.user_id = '00000000-0000-4000-8000-00000000000a'
  and r.name = 'Electric & water'
  and o.projected_date = '2026-08-28';

update public.occurrences o
set is_overridden = true, actual_amount_cents = -449600
from public.recurring_rules r
where r.id = o.rule_id
  and r.user_id = '00000000-0000-4000-8000-00000000000a'
  and r.name = 'Car payment'
  and o.projected_date = '2026-08-20';

update public.occurrences o
set status = 'skipped', is_overridden = true
from public.recurring_rules r
where r.id = o.rule_id
  and r.user_id = '00000000-0000-4000-8000-00000000000a'
  and r.name = 'Streaming'
  and o.projected_date = '2026-10-08';

-- transfers
insert into public.transfers (id, user_id, from_account_id, to_account_id, amount_cents, occurs_on) values
  ('30000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8001-00000000000a',
   40000, '2026-08-01'),
  ('30000000-0000-4000-8001-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8001-00000000000a', '10000000-0000-4000-8000-00000000000a',
   15000, '2026-07-18'),
  ('30000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b',
   '10000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8001-00000000000b',
   7500, '2026-08-05');
