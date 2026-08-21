-- Runway: the core domain schema — accounts, recurring_rules, occurrences,
-- transfers, user_settings. See docs/database/schema.md for the entity
-- diagram, the domain mapping table, and the regeneration contract.
--
-- Every table here follows docs/database/rls.md's pattern, with one addition:
-- child tables declare a composite foreign key against a parent's
-- `unique (user_id, id)` rather than a plain `references parent (id)`. A plain
-- FK is checked as the table owner and bypasses RLS, so user A could otherwise
-- insert a rule pointing at user B's account. The composite form makes
-- cross-user references a foreign-key violation, not merely a policy denial —
-- "impossible at the data layer," per the issue.

-- ── enums ────────────────────────────────────────────────────────────────────
create type public.recurring_kind as enum ('bill', 'income');
create type public.recurring_cadence as enum ('weekly', 'biweekly', 'monthly', 'annual');
create type public.recurring_amount_source as enum ('fixed', 'predicted');
create type public.occurrence_status as enum ('projected', 'confirmed', 'skipped');

-- ── updated_at maintenance ───────────────────────────────────────────────────
-- Lives in `private`: EXECUTE on new functions in `public` is revoked from
-- PUBLIC by 20260817020810, and a SECURITY DEFINER helper in `public` is an
-- unauthenticated endpoint. SECURITY INVOKER (the default) is stated for the
-- reader. `set search_path = ''` is safe with an unqualified now(): pg_catalog
-- is always implicitly searched.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

-- ── day-set normalisation ────────────────────────────────────────────────────
-- Sorts and de-duplicates recurring_rules.days_of_month / days_of_week so
-- {15,1} and {1,15,15} are one stored value rather than three. Without this,
-- equality on a rule's day set depends on the order somebody typed it in.
--
-- A check constraint cannot do this — checks may not contain subqueries, and
-- unnest/array_agg is the only way to sort an array — hence a BEFORE trigger,
-- which fires before the constraints and so leaves them looking at the
-- canonical value. An empty array is left exactly as it came in, for the
-- constraint to reject; normalising it to null here would turn "no days" into
-- "the anchor's day" behind the caller's back.
create or replace function private.normalize_recurring_rule_days()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if cardinality(new.days_of_month) > 0 then
    new.days_of_month := (
      select array_agg(distinct d order by d) from unnest(new.days_of_month) as d
    );
  end if;
  if cardinality(new.days_of_week) > 0 then
    new.days_of_week := (
      select array_agg(distinct d order by d) from unnest(new.days_of_week) as d
    );
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_recurring_rule_days() from public;

-- ── accounts ─────────────────────────────────────────────────────────────────
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- A design-token slot, not domain vocabulary: text + check rather than an
  -- enum so a palette change is a constraint swap, not a type migration.
  -- chart-1 is the combined line and chart-5 is what-if tinting; neither is
  -- assignable. Mirrors domain/types.ts ACCOUNT_COLORS.
  color text not null check (color in ('chart-2', 'chart-3', 'chart-4')),
  -- Signed on purpose: an overdrawn account is a real reading.
  balance_cents bigint not null,
  balance_as_of date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The anchor every child's composite FK references. Leads with user_id, so it
  -- also serves the RLS predicate and the auth.users FK; a separate
  -- accounts_user_id_idx would be a redundant duplicate. See docs/database/rls.md.
  constraint accounts_user_id_id_key unique (user_id, id)
);

-- ── recurring_rules ──────────────────────────────────────────────────────────
create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  kind public.recurring_kind not null,
  -- Positive magnitude, always. The sign is derived from `kind` when
  -- occurrences are materialized, mirroring domain/projection.ts signedAmount.
  amount_cents bigint not null check (amount_cents > 0),
  amount_source public.recurring_amount_source not null default 'fixed',
  is_variable boolean not null default false,
  cadence public.recurring_cadence not null,
  -- The cadence's phase: which week a biweekly rule falls in, which
  -- month-and-day an annual one lands on, and — when no day set is given below
  -- — the weekday or day-of-month everything else aligns to.
  anchor_date date not null,
  -- Optional multi-day expansion. Null in the common case, and null is NOT the
  -- empty set: it means "the single day anchor_date names". The empty array is
  -- rejected rather than quietly normalised into null, so a caller that meant
  -- to write days and wrote none hears about it.
  --
  -- days_of_month widens a monthly rule to several days per month. {1,15} is
  -- semi-monthly, the shape most paychecks take; any other combination works
  -- the same way. -1 is the last day of the month, so "the 1st and the last" is
  -- sayable outright instead of being encoded as 31 and inferred. A day past
  -- the end of a short month clamps to that month's last day, and a clamp
  -- collision — {30,31} in February — is one occurrence, not two.
  --
  -- days_of_week widens a weekly or biweekly rule the same way, in ISO weekday
  -- numbers: 1 = Monday through 7 = Sunday. Biweekly keeps taking its phase
  -- from anchor_date — the week containing it, then every other week.
  --
  -- Deliberately not an enum of named cadences. Semi-monthly as its own enum
  -- value would cover exactly one of these arrangements and make the next one
  -- ("the 5th and the 20th") another migration; a set of days covers all of
  -- them and needs no vocabulary. The engine mirrors this in domain/cadence.ts.
  days_of_month smallint[],
  days_of_week smallint[],
  -- Inclusive, nullable = unbounded. Apply-to-future closes a rule with
  -- ends_on and opens a new one at starts_on; occurrence rows are never
  -- bulk-updated.
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_rules_user_id_id_key unique (user_id, id),
  -- Target for occurrences_rule_fk: lets a child reference the rule *and* the
  -- account it belongs to as one unit, so the two cannot drift apart.
  constraint recurring_rules_user_id_id_account_id_key unique (user_id, id, account_id),
  constraint recurring_rules_account_fk
    foreign key (user_id, account_id)
    references public.accounts (user_id, id) on delete cascade,
  constraint recurring_rules_window_ck
    check (starts_on is null or ends_on is null or ends_on >= starts_on),
  constraint recurring_rules_predicted_is_income_ck
    check (amount_source = 'fixed' or kind = 'income'),
  constraint recurring_rules_variable_is_bill_ck
    check (not is_variable or kind = 'bill'),
  -- cardinality, not array_length: array_length('{}', 1) is null, and a check
  -- constraint whose expression is null PASSES. The empty array would sail
  -- straight through a `between` written against array_length.
  constraint recurring_rules_days_of_month_ck check (
    days_of_month is null or (
      cadence = 'monthly'
      and cardinality(days_of_month) between 1 and 32
      and array_position(days_of_month, null) is null
      and days_of_month <@ '{-1,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31}'::smallint[]
    )
  ),
  constraint recurring_rules_days_of_week_ck check (
    days_of_week is null or (
      cadence in ('weekly', 'biweekly')
      and cardinality(days_of_week) between 1 and 7
      and array_position(days_of_week, null) is null
      and days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]
    )
  )
);

-- ── occurrences ──────────────────────────────────────────────────────────────
create table public.occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Denormalised from the rule so the projection index can be
  -- (user_id, account_id, projected_date) without a join.
  account_id uuid not null,
  rule_id uuid not null,
  -- Written by generation, never by a user. This is half the natural key, and
  -- keeping it immutable is what lets an override survive regeneration.
  projected_date date not null,
  -- Signed: income positive, bills negative. Mirrors domain Occurrence.amount.
  projected_amount_cents bigint not null,
  -- The values that supersede the projection, whether because the user edited
  -- this instance (status stays 'projected', is_overridden true) or because it
  -- happened (status 'confirmed'). A null actual_date means "on projected_date".
  actual_date date,
  actual_amount_cents bigint,
  status public.occurrence_status not null default 'projected',
  -- Regeneration must skip any row where is_overridden or status <> 'projected'.
  is_overridden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The key regeneration upserts on.
  constraint occurrences_rule_projected_date_key unique (rule_id, projected_date),
  constraint occurrences_account_fk
    foreign key (user_id, account_id)
    references public.accounts (user_id, id) on delete cascade,
  -- Includes account_id on purpose. account_id is denormalised from the rule,
  -- and this is what stops the copy disagreeing with its source: an occurrence
  -- whose account is not its rule's account has no parent row to reference.
  -- Reassigning a live rule to another account is therefore rejected rather
  -- than silently leaving its occurrences behind — like apply-to-future, that
  -- change is a rule split, not an in-place edit.
  constraint occurrences_rule_fk
    foreign key (user_id, rule_id, account_id)
    references public.recurring_rules (user_id, id, account_id) on delete cascade,
  constraint occurrences_confirmed_has_actual_ck
    check (status <> 'confirmed' or actual_amount_cents is not null)
);

-- ── transfers ────────────────────────────────────────────────────────────────
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_account_id uuid not null,
  to_account_id uuid not null,
  -- One positive amount, two derived legs. Net-zero is structural: there is no
  -- second row that can drift. A transfer here is a classification of a paired
  -- outflow/inflow the user already made — Runway never initiates a movement —
  -- so it is one fact and lives in one row. Settled, not provisional: see
  -- "One row, not two legs" in docs/database/schema.md.
  amount_cents bigint not null check (amount_cents > 0),
  occurs_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transfers_distinct_accounts_ck check (from_account_id <> to_account_id),
  constraint transfers_from_account_fk
    foreign key (user_id, from_account_id)
    references public.accounts (user_id, id) on delete cascade,
  constraint transfers_to_account_fk
    foreign key (user_id, to_account_id)
    references public.accounts (user_id, id) on delete cascade
);

-- ── user_settings ────────────────────────────────────────────────────────────
-- One row per user, so "exactly one discretionary source" is structural rather
-- than an invariant somebody has to re-establish on every write. user_id is the
-- primary key; that index is the RLS predicate index.
create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cushion_cents bigint not null default 60000 check (cushion_cents >= 0),
  monthly_discretionary_cents bigint not null default 0
    check (monthly_discretionary_cents >= 0),
  discretionary_account_id uuid,
  -- How far the dashboard projects by default. The toggle happens to offer
  -- 30/60/90, but that is a fact about one screen, not about the data: pinning
  -- the schema to those three would make "let me see two weeks" a migration for
  -- no gain. The bound here is a sanity range, not a menu.
  default_horizon_days smallint not null default 30
    check (default_horizon_days between 1 and 730),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The column list on SET NULL (PG 15+) is required: without it, deleting the
  -- account would null user_id too.
  constraint user_settings_discretionary_account_fk
    foreign key (user_id, discretionary_account_id)
    references public.accounts (user_id, id)
    on delete set null (discretionary_account_id)
);

-- ── indexes ──────────────────────────────────────────────────────────────────
create index recurring_rules_user_id_account_id_idx
  on public.recurring_rules (user_id, account_id);

-- The projection engine's read pattern, named in the issue.
create index occurrences_user_id_account_id_projected_date_idx
  on public.occurrences (user_id, account_id, projected_date);

create index transfers_user_id_occurs_on_idx
  on public.transfers (user_id, occurs_on desc, created_at desc);
create index transfers_user_id_from_account_id_idx
  on public.transfers (user_id, from_account_id);
create index transfers_user_id_to_account_id_idx
  on public.transfers (user_id, to_account_id);

-- ── updated_at triggers ──────────────────────────────────────────────────────
-- One per domain table, no exceptions, so the rule needs no lookup.
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function private.set_updated_at();
create trigger recurring_rules_set_updated_at
  before update on public.recurring_rules
  for each row execute function private.set_updated_at();
-- Insert as well as update: a day set arrives unsorted the first time too.
create trigger recurring_rules_normalize_days
  before insert or update on public.recurring_rules
  for each row execute function private.normalize_recurring_rule_days();
create trigger occurrences_set_updated_at
  before update on public.occurrences
  for each row execute function private.set_updated_at();
create trigger transfers_set_updated_at
  before update on public.transfers
  for each row execute function private.set_updated_at();
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function private.set_updated_at();

-- ── RLS: accounts ────────────────────────────────────────────────────────────
alter table public.accounts enable row level security;
grant select, insert, update, delete on public.accounts to authenticated;

create policy accounts_select_own on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy accounts_insert_own on public.accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy accounts_update_own on public.accounts
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy accounts_delete_own on public.accounts
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── RLS: recurring_rules ─────────────────────────────────────────────────────
alter table public.recurring_rules enable row level security;
grant select, insert, update, delete on public.recurring_rules to authenticated;

create policy recurring_rules_select_own on public.recurring_rules
  for select to authenticated using ((select auth.uid()) = user_id);
create policy recurring_rules_insert_own on public.recurring_rules
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy recurring_rules_update_own on public.recurring_rules
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy recurring_rules_delete_own on public.recurring_rules
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── RLS: occurrences ─────────────────────────────────────────────────────────
alter table public.occurrences enable row level security;
grant select, insert, update, delete on public.occurrences to authenticated;

create policy occurrences_select_own on public.occurrences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy occurrences_insert_own on public.occurrences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy occurrences_update_own on public.occurrences
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy occurrences_delete_own on public.occurrences
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── RLS: transfers ───────────────────────────────────────────────────────────
alter table public.transfers enable row level security;
grant select, insert, update, delete on public.transfers to authenticated;

create policy transfers_select_own on public.transfers
  for select to authenticated using ((select auth.uid()) = user_id);
create policy transfers_insert_own on public.transfers
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy transfers_update_own on public.transfers
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy transfers_delete_own on public.transfers
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── RLS: user_settings ───────────────────────────────────────────────────────
alter table public.user_settings enable row level security;
grant select, insert, update, delete on public.user_settings to authenticated;

create policy user_settings_select_own on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy user_settings_update_own on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy user_settings_delete_own on public.user_settings
  for delete to authenticated using ((select auth.uid()) = user_id);
