-- Issue #15, the occurrence editor. Three RPCs, one file: `override_occurrence`
-- and `revert_occurrence` are the "this occurrence only" path, and
-- `split_recurring_rule` is the "apply to all future" path. See
-- docs/database/schema.md, "The regeneration contract" and "Rule splitting",
-- for the invariants these lean on, and the design decision in
-- .claude/runway-runner/tasks/15/plan.md for why an overlay of stored
-- overrides was chosen over materializing occurrences as the engine's source
-- of truth.
--
-- All three: `language plpgsql`, `security invoker`, `set search_path = ''`,
-- `v_user_id uuid := (select auth.uid())` with a `not authenticated` guard,
-- every name schema-qualified, `revoke all ... from public` then
-- `grant execute ... to authenticated`, and a `comment on function`. Copied
-- from `supabase/migrations/20260831011511_accounts_atomic_writes.sql`.
-- `user_id` is never a parameter of any of the three.
--
-- Error signalling uses PostgREST's `PTxyz` convention
-- (https://postgrest.org/en/stable/references/errors.html#raise-errcode) so a
-- rejection carries a distinguishable HTTP status without risking `P0002`,
-- which PostgREST maps to a bare 500. Messages never carry a name, an amount
-- or a balance — CLAUDE.md, extended to database error text.

-- ── override_occurrence ──────────────────────────────────────────────────────
-- "This occurrence only." Writes `actual_amount_cents` / `actual_date` /
-- `is_overridden = true` on the occurrence named by the natural key
-- `(rule_id, projected_date)` — never by the row's uuid, so a first-time edit
-- of an occurrence the horizon top-up has not materialized yet still lands
-- (the insert branch below), instead of failing on materialization lag.
--
-- The `on conflict ... do update` in the insert branch is what makes a second,
-- concurrent first-time override resolve to one row rather than a duplicate-key
-- error, and is also what makes a *second* edit of an already-overridden row
-- succeed: `private.protect_materialized_occurrence()` (20260904015555) only
-- objects to a write that changes `projected_amount_cents` or `projected_date`,
-- and this function never touches either.
create or replace function public.override_occurrence(
  p_rule_id uuid,
  p_projected_date date,
  p_projected_amount_cents bigint,
  p_actual_amount_cents bigint,
  p_actual_date date
)
returns public.occurrences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_account_id uuid;
  v_occurrence public.occurrences;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- The rejection: RLS makes a foreign rule invisible, so this select finds
  -- nothing for a rule id belonging to another user, and the explicit
  -- `user_id = v_user_id` predicate holds even against a hypothetical
  -- BYPASSRLS caller. Raising here rather than falling through to a no-op
  -- update is what turns "affects zero rows" into an error the client sees.
  select account_id into v_account_id
    from public.recurring_rules
   where id = p_rule_id
     and user_id = v_user_id;

  if not found then
    raise sqlstate 'PT404' using message = 'recurring rule not found';
  end if;

  select * into v_occurrence
    from public.occurrences
   where rule_id = p_rule_id
     and projected_date = p_projected_date
     and user_id = v_user_id
     for update;

  if found and v_occurrence.status <> 'projected' then
    -- Editing a confirmed or skipped occurrence is reconciliation (#26), not
    -- this issue — the overlay this RPC feeds only ever reads `projected`
    -- rows back (app/composables/useRunwayData.ts), so a settled row reaching
    -- here at all would mean a stale client, not a legitimate edit.
    raise sqlstate 'PT409' using message = 'only a projected occurrence can be edited';
  end if;

  if found then
    update public.occurrences
       set actual_amount_cents = p_actual_amount_cents,
           actual_date = p_actual_date,
           is_overridden = true
     where id = v_occurrence.id
    returning * into v_occurrence;
  else
    -- Materialization has not reached this date yet. Inserting here — rather
    -- than requiring the caller to regenerate first and retry — is what makes
    -- the write independent of materialization lag; see the design decision.
    insert into public.occurrences
           (user_id, account_id, rule_id, projected_date, projected_amount_cents,
            actual_amount_cents, actual_date, is_overridden)
    values (v_user_id, v_account_id, p_rule_id, p_projected_date, p_projected_amount_cents,
            p_actual_amount_cents, p_actual_date, true)
    on conflict on constraint occurrences_rule_projected_date_key
    do update set actual_amount_cents = excluded.actual_amount_cents,
                  actual_date = excluded.actual_date,
                  is_overridden = true
    returning * into v_occurrence;
  end if;

  return v_occurrence;
end;
$$;

comment on function public.override_occurrence(uuid, date, bigint, bigint, date) is
  'Applies a single-occurrence edit ("this occurrence only"), keyed by the (rule_id, projected_date) natural key so it works even before materialization reaches the date. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.override_occurrence(uuid, date, bigint, bigint, date) from public;
grant execute on function public.override_occurrence(uuid, date, bigint, bigint, date) to authenticated;

-- ── revert_occurrence ────────────────────────────────────────────────────────
-- Clears an override back to the rule's own value. Refuses a settled row for
-- the same reason override_occurrence does — but here it is not merely a scope
-- question: clearing actual_amount_cents on a confirmed row would violate
-- occurrences_confirmed_has_actual_ck.
create or replace function public.revert_occurrence(
  p_rule_id uuid,
  p_projected_date date
)
returns public.occurrences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_occurrence public.occurrences;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_occurrence
    from public.occurrences
   where rule_id = p_rule_id
     and projected_date = p_projected_date
     and user_id = v_user_id
     for update;

  if not found then
    raise sqlstate 'PT404' using message = 'occurrence not found';
  end if;

  if v_occurrence.status <> 'projected' then
    raise sqlstate 'PT409' using message = 'a settled occurrence cannot be reverted';
  end if;

  update public.occurrences
     set actual_amount_cents = null,
         actual_date = null,
         is_overridden = false
   where id = v_occurrence.id
  returning * into v_occurrence;

  return v_occurrence;
end;
$$;

comment on function public.revert_occurrence(uuid, date) is
  'Clears a single-occurrence override back to the rule''s own projected value. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.revert_occurrence(uuid, date) from public;
grant execute on function public.revert_occurrence(uuid, date) to authenticated;

-- ── split_recurring_rule ─────────────────────────────────────────────────────
-- "Apply to all future." Closes the existing rule the day before the change
-- and opens a successor from the change date, rather than bulk-editing
-- occurrence rows — docs/database/schema.md "Rule splitting" states why:
-- occurrence rows must stay a record of what was actually projected at the
-- time, not be rewritten to match a later decision.
--
-- Amount only, deliberately — there is no date parameter. Retiming a
-- successor would mean moving anchor_date, and for a rule carrying
-- days_of_month/days_of_week the anchor is not what picks the day, so "move
-- it to the 5th" would be silently ignored for a semi-monthly rule. If
-- retiming-forward is ever wanted, it is a new parameter and a new guard on
-- its own issue, not this one.
create or replace function public.split_recurring_rule(
  p_rule_id uuid,
  p_effective_from date,
  p_amount_cents bigint
)
returns table (closed_rule_id uuid, successor_rule_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_rule public.recurring_rules;
  v_effective_start date;
  v_successor_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_amount_cents <= 0 then
    raise sqlstate 'PT400' using message = 'amount must be a positive magnitude';
  end if;

  select * into v_rule
    from public.recurring_rules
   where id = p_rule_id
     and user_id = v_user_id
     for update;

  if not found then
    raise sqlstate 'PT404' using message = 'recurring rule not found';
  end if;

  if v_rule.ends_on is not null and p_effective_from > v_rule.ends_on then
    raise sqlstate 'PT409' using message = 'the change date falls after this rule ends';
  end if;

  v_effective_start := greatest(v_rule.anchor_date, coalesce(v_rule.starts_on, v_rule.anchor_date));

  if p_effective_from <= v_effective_start then
    -- Nothing precedes the change date, so there is no predecessor to keep —
    -- editing the rule in place *is* "every occurrence from here on". Without
    -- this branch, ends_on = p_effective_from - 1 would violate
    -- recurring_rules_window_ck (ends_on >= starts_on) and would leave an
    -- occurrence-free orphan rule behind.
    update public.recurring_rules
       set amount_cents = p_amount_cents
     where id = v_rule.id
       and user_id = v_user_id;

    return query select null::uuid, v_rule.id;
    return;
  end if;

  -- ends_on = p_effective_from - 1, not p_effective_from: starts_on/ends_on
  -- are inclusive (see the core schema migration and domain/cadence.ts), so an
  -- ends_on of p_effective_from would let both rules emit that day.
  update public.recurring_rules
     set ends_on = p_effective_from - 1
   where id = v_rule.id
     and user_id = v_user_id;

  -- v_rule is the pre-update snapshot, so v_rule.ends_on here is still the
  -- *old* bound — the successor inherits it rather than the just-written
  -- p_effective_from - 1. starts_on equals anchor_date so the window opens
  -- exactly on-cadence, producing no partial-month occurrence at the seam.
  insert into public.recurring_rules
         (user_id, account_id, name, kind, amount_cents, amount_source, is_variable,
          cadence, days_of_month, days_of_week, anchor_date, starts_on, ends_on)
  values (v_user_id, v_rule.account_id, v_rule.name, v_rule.kind, p_amount_cents,
          v_rule.amount_source, v_rule.is_variable, v_rule.cadence, v_rule.days_of_month,
          v_rule.days_of_week, p_effective_from, p_effective_from, v_rule.ends_on)
  returning id into v_successor_id;

  return query select v_rule.id, v_successor_id;
end;
$$;

comment on function public.split_recurring_rule(uuid, date, bigint) is
  'Closes a recurring rule the day before p_effective_from and opens a successor at the new amount from that day forward ("apply to all future"). Amount-only: retiming a day-set rule is out of scope. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.split_recurring_rule(uuid, date, bigint) from public;
grant execute on function public.split_recurring_rule(uuid, date, bigint) to authenticated;
