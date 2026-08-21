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
  -- 103417, not a rounder 103400: domain/discretionary.ts dailyFromMonthly is
  -- round(monthly * 12 / 365), and only 103402..103431 land on the $34.00/day
  -- that domain/seed.ts and the design both use. 103400 gives $33.99, and that
  -- cent compounds every single day of the burndown.
  ('00000000-0000-4000-8000-00000000000a', 60000, 103417,
   '10000000-0000-4000-8000-00000000000a', 30),
  ('00000000-0000-4000-8000-00000000000b', 30000, 50000,
   '10000000-0000-4000-8000-00000000000b', 60);

-- recurring_rules.
--
-- **User A's rules must mirror domain/seed.ts, rule for rule.** That module is
-- what every screen renders today and what the figures quoted in
-- docs/design/*/spec.md were computed from, so a rule that exists here and not
-- there means the local database and the screenshots describe different
-- households. New cadence fixtures therefore go on **user B**, who mirrors
-- nothing and exists so the RLS suite has cross-user rows to probe.
--
-- The one deliberate exception is the Rent split: user A carries an August rule
-- that ends and a September rule that starts, at a higher amount, because
-- apply-to-future has to be visible somewhere. See docs/database/schema.md.
--
-- days_of_month is null everywhere but B's paycheck, which is the point: null
-- means "the day anchor_date names".
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
   'monthly', '2026-08-31', null, null, null),
  ('20000000-0000-4000-8005-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Phone', 'bill', 5500, 'fixed', false,
   'monthly', '2026-09-03', null, null, null),
  ('20000000-0000-4000-8006-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8001-00000000000a', 'Streaming', 'bill', 1800, 'fixed', false,
   'monthly', '2026-09-08', null, null, null),
  -- The split pair: the August rule closes with ends_on, the September rule
  -- opens with starts_on == anchor_date. Apply-to-future is this split, never
  -- a bulk occurrence edit — see docs/database/schema.md.
  --
  -- The increase runs 1550 -> 1650, not 1650 -> 1750, so the *forward-looking*
  -- rule is the one that matches domain/seed.ts and the -$1,650 that
  -- docs/design/shortfall/spec.md quotes for Sep 1. A split has to put the
  -- divergence on one side or the other; it belongs on the closed August rule,
  -- which no screen and no spec figure reads.
  ('20000000-0000-4000-8007-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Rent', 'bill', 155000, 'fixed', false,
   'monthly', '2026-08-01', null, '2026-08-31', null),
  ('20000000-0000-4000-8008-00000000000a', '00000000-0000-4000-8000-00000000000a',
   '10000000-0000-4000-8000-00000000000a', 'Rent', 'bill', 165000, 'fixed', false,
   'monthly', '2026-09-01', '2026-09-01', null, null),
  ('20000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b',
   '10000000-0000-4000-8000-00000000000b', 'B Rent', 'bill', 90000, 'fixed', false,
   'monthly', '2026-09-01', null, null, null),
  -- Semi-monthly, the 1st and the 15th — the way a large share of people are
  -- actually paid, and the fixture for days_of_month. It sits on user B rather
  -- than user A precisely because user A may not drift from domain/seed.ts.
  --
  -- Written unsorted on purpose: the normalising trigger stores it as {1,15},
  -- and `db:reset` failing to do that is worth noticing here rather than in a
  -- projection three screens away.
  ('20000000-0000-4000-8001-00000000000b', '00000000-0000-4000-8000-00000000000b',
   '10000000-0000-4000-8000-00000000000b', 'B Paycheck', 'income', 120000, 'fixed', false,
   'monthly', '2026-08-15', null, null, '{15,1}');

-- occurrences — materialized from every rule above, from its effective start
-- (anchor, or starts_on if later) through 2026-12-31.
--
-- Two passes, split by how the cadence steps, because one `generate_series`
-- cannot do both correctly.
--
-- The month-aligned pass below steps over **month starts**, never over the
-- occurrence dates themselves. That is not a stylistic choice. Postgres'
-- `generate_series(d, ..., interval '1 month')` is sticky: from 2026-01-31 it
-- yields Jan 31, Feb 28, then **Mar 28** — the February clamp carries forward
-- and every later date is wrong. domain/dates.ts addMonthsClamped is not
-- sticky, and gives Mar 31. Starting from the 1st of each month and applying
-- the day afterwards removes the stickiness entirely, so a rule anchored on the
-- 29th, 30th or 31st now generates exactly what the engine projects. Before
-- this, the seed silently required every monthly anchor to be day <= 28.

-- Weekly and biweekly: a fixed number of days, so stepping over the dates
-- themselves is already correct.
insert into public.occurrences (user_id, account_id, rule_id, projected_date, projected_amount_cents)
select r.user_id, r.account_id, r.id, d::date,
       case when r.kind = 'income' then r.amount_cents else -r.amount_cents end
from public.recurring_rules r
cross join lateral generate_series(
  greatest(r.anchor_date, coalesce(r.starts_on, r.anchor_date))::timestamp,
  least(coalesce(r.ends_on, date '2026-12-31'), date '2026-12-31')::timestamp,
  case r.cadence when 'weekly' then interval '7 days' else interval '14 days' end
) as d
where r.cadence in ('weekly', 'biweekly')
  -- No seeded rule carries a weekday set. This pass would ignore one, so it
  -- refuses to guess instead: add the pass when a fixture needs it.
  and r.days_of_week is null;

-- Monthly and annual: month starts, then the days inside each month.
-- `coalesce(days_of_month, the anchor's day)` is what makes a plain monthly
-- rule and a day-set rule the same code path — a rule with no day set is just
-- one with a single day. `least(..., month end)` is the clamp the engine
-- performs, and `distinct` collapses days that clamp onto the same date, since
-- `occurrences` is unique on (rule_id, projected_date).
insert into public.occurrences (user_id, account_id, rule_id, projected_date, projected_amount_cents)
select distinct r.user_id, r.account_id, r.id, occurrence.occurs_on,
       case when r.kind = 'income' then r.amount_cents else -r.amount_cents end
from public.recurring_rules r
cross join lateral generate_series(
  date_trunc('month', greatest(r.anchor_date, coalesce(r.starts_on, r.anchor_date))),
  date_trunc('month', least(coalesce(r.ends_on, date '2026-12-31'), date '2026-12-31')),
  case r.cadence when 'annual' then interval '1 year' else interval '1 month' end
) as cycle_start
cross join lateral unnest(
  coalesce(r.days_of_month, array[extract(day from r.anchor_date)::smallint])
) as wanted_day
cross join lateral (
  select case
    when wanted_day = -1 then (cycle_start + interval '1 month - 1 day')::date
    else least(
      cycle_start::date + (wanted_day - 1),
      (cycle_start + interval '1 month - 1 day')::date
    )
  end as occurs_on
) as occurrence
where r.cadence in ('monthly', 'annual')
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

-- -44960 is $449.60 against a $310 rule: one instance edited upward, the way a
-- car payment picks up a late fee or an extra principal payment. It was -449600
-- — $4,496, fourteen times the rule — which is a units slip, not a scenario:
-- nothing in the comment above or in docs/design/ asks for a hit that size, and
-- it dropped Checking through the floor on the very day the design calls the
-- low point. A deliberately *short* scenario would be worth seeding, but it
-- should say so and match docs/design/dashboard/spec.md; this row does not.
update public.occurrences o
set is_overridden = true, actual_amount_cents = -44960
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
