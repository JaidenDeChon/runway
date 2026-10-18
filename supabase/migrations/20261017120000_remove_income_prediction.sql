-- Income prediction is dropped (issue #18, closed as not planned). Nothing
-- in the app offered it in practice: "Predict from deposits" needed a deposit
-- history that nothing ever recorded, so every rule was `fixed`. This removes
-- the schema that only existed for it.
--
-- It also has to undo three migrations that are in *no* branch anymore. PR #95
-- (closed unmerged) pushed 20260924020000_income_prediction,
-- 20260924030000_recent_settled_amounts_bounds and
-- 20260925010000_settle_occurrence to the hosted project so its deploy preview
-- could load. They added `user_settings.prediction_window`,
-- `recent_settled_amounts()`, `settle_occurrence()` / `unsettle_occurrence()`,
-- and redefined `split_recurring_rule`. Every statement for those objects is
-- `if exists`, so this file does the same thing on a database that never had
-- them (local, CI, a fresh project) as on one that did (hosted). The hosted
-- migration history still lists those three versions after this runs, with no
-- file behind them; marking them reverted is a one-time manual step
-- (`supabase migration repair --status reverted <version>...`) recorded in the
-- PR that adds this file.
--
-- Rows are not touched. A `confirmed` occurrence written by PR #95's settle
-- RPC is a protected row that regeneration already leaves alone and the app
-- does not read (schema.md, "The regeneration contract"), so it is inert.

-- ── 1. PR #95's objects (present only on hosted) ────────────────────────────

drop function if exists public.settle_occurrence(uuid, date, bigint, bigint, date);
drop function if exists public.unsettle_occurrence(uuid, date);
drop function if exists public.recent_settled_amounts();

alter table public.user_settings
  drop column if exists prediction_window;

-- ── 2. split_recurring_rule, without amount_source ──────────────────────────
-- Body identical to 20260913090000 apart from the successor insert, which no
-- longer copies `amount_source`. On hosted this also replaces PR #95's
-- redefinition, which changed what apply-to-future does with the amount.
-- Replaced before the column is dropped: plpgsql resolves the column only
-- when the function runs, but nothing should be left referring to it.

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
         (user_id, account_id, name, kind, amount_cents, is_variable,
          cadence, days_of_month, days_of_week, anchor_date, starts_on, ends_on)
  values (v_user_id, v_rule.account_id, v_rule.name, v_rule.kind, p_amount_cents,
          v_rule.is_variable, v_rule.cadence, v_rule.days_of_month,
          v_rule.days_of_week, p_effective_from, p_effective_from, v_rule.ends_on)
  returning id into v_successor_id;

  return query select v_rule.id, v_successor_id;
end;
$$;

comment on function public.split_recurring_rule(uuid, date, bigint) is
  'Closes a recurring rule the day before p_effective_from and opens a successor at the new amount from that day forward ("apply to all future"). Amount-only: retiming a day-set rule is out of scope. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.split_recurring_rule(uuid, date, bigint) from public;
grant execute on function public.split_recurring_rule(uuid, date, bigint) to authenticated;

-- ── 3. recurring_rules.amount_source ────────────────────────────────────────
-- The stored amount is already what projection reads for a `predicted` rule
-- (prediction was resolved at save time), so dropping the column changes no
-- figure: every rule is simply a fixed amount from here on.

alter table public.recurring_rules
  drop constraint recurring_rules_predicted_is_income_ck,
  drop column amount_source;

drop type public.recurring_amount_source;
