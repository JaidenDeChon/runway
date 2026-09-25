-- Manual settlement — the manual-entry half of issue #26 (Actuals
-- reconciliation), folded into issue #18's PR. Two RPCs: `settle_occurrence`
-- records what actually happened to one occurrence ("Mark as paid" /
-- "Mark as received"), and `unsettle_occurrence` takes that back ("the user
-- can always unmatch").
--
-- Settled means `status = 'confirmed'` and nothing else (docs/database/
-- schema.md § Estimated amounts), so a settled row is exactly what
-- `recent_settled_amounts()` (20260924020000 / 20260924030000) already reads:
-- settling is what finally feeds an estimated rule its history, and the
-- estimate for every later occurrence moves with it. That is the "corrections
-- propagate forward without disturbing history" requirement, met without a
-- second mechanism. Matching *imported* transactions against occurrences is
-- the other half of #26 and waits on an import source (#22); when it lands it
-- calls these same two functions.
--
-- Both copy the conventions of `override_occurrence` / `revert_occurrence`
-- (20260913090000): `language plpgsql`, `security invoker`,
-- `set search_path = ''`, `v_user_id uuid := (select auth.uid())` with a
-- `not authenticated` guard, every name schema-qualified, keyed on the
-- `(rule_id, projected_date)` natural key, `PTxyz` error codes, messages that
-- never carry a name or an amount, `revoke all ... from public` then
-- `grant execute ... to authenticated`. `user_id` is never a parameter.
--
-- Neither touches `projected_date` or `projected_amount_cents`, so
-- `private.protect_materialized_occurrence()` has nothing to object to; and a
-- `confirmed` row is protected from `regenerate_occurrences` by the status
-- predicate it already carries.

-- ── settle_occurrence ────────────────────────────────────────────────────────
-- Writes `status = 'confirmed'` with the actual amount and date. Leaves
-- `is_overridden` as it found it, so `unsettle_occurrence` can tell an
-- occurrence the user had hand-edited before settling it from one they had
-- not.
--
-- The amount's sign must match the rule's kind and must not be zero. A wrong
-- sign cannot be a deposit or a payment of this rule, and
-- `domain/prediction.ts` `settledMagnitude` would drop it from the history
-- anyway: refusing it here means a settled row always counts, instead of
-- quietly not counting. A cycle that did not happen is `skipped`, not a zero.
create or replace function public.settle_occurrence(
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
  v_rule public.recurring_rules;
  v_occurrence public.occurrences;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_actual_date is null then
    raise sqlstate 'PT400' using message = 'a settled occurrence needs a date';
  end if;

  -- RLS hides another user's rule, so a foreign id finds nothing here; the
  -- explicit predicate holds even for a hypothetical BYPASSRLS caller.
  select * into v_rule
    from public.recurring_rules
   where id = p_rule_id
     and user_id = v_user_id;

  if not found then
    raise sqlstate 'PT404' using message = 'recurring rule not found';
  end if;

  if p_actual_amount_cents is null
     or (v_rule.kind = 'income' and p_actual_amount_cents <= 0)
     or (v_rule.kind = 'bill' and p_actual_amount_cents >= 0) then
    raise sqlstate 'PT400' using message = 'the amount''s sign does not match the item';
  end if;

  select * into v_occurrence
    from public.occurrences
   where rule_id = p_rule_id
     and projected_date = p_projected_date
     and user_id = v_user_id
     for update;

  if found and v_occurrence.status <> 'projected' then
    -- Already settled (or skipped). Re-settling would silently overwrite a
    -- recorded fact; the client unsettles first if the record was wrong.
    raise sqlstate 'PT409' using message = 'this occurrence is already settled';
  end if;

  if found then
    update public.occurrences
       set status = 'confirmed',
           actual_amount_cents = p_actual_amount_cents,
           actual_date = p_actual_date
     where id = v_occurrence.id
    returning * into v_occurrence;
  else
    -- Not materialized yet (or not any more): the same insert branch, and
    -- the same reason, as override_occurrence's.
    insert into public.occurrences
           (user_id, account_id, rule_id, projected_date, projected_amount_cents,
            actual_amount_cents, actual_date, status)
    values (v_user_id, v_rule.account_id, p_rule_id, p_projected_date, p_projected_amount_cents,
            p_actual_amount_cents, p_actual_date, 'confirmed')
    on conflict on constraint occurrences_rule_projected_date_key
    do update set actual_amount_cents = excluded.actual_amount_cents,
                  actual_date = excluded.actual_date,
                  status = 'confirmed'
          where occurrences.status = 'projected'
    returning * into v_occurrence;

    if v_occurrence.id is null then
      -- Lost a race with a concurrent settle of the same occurrence.
      raise sqlstate 'PT409' using message = 'this occurrence is already settled';
    end if;
  end if;

  return v_occurrence;
end;
$$;

comment on function public.settle_occurrence(uuid, date, bigint, bigint, date) is
  'Records what actually happened to one occurrence (status = confirmed, with its actual amount and date), keyed by the (rule_id, projected_date) natural key. The amount''s sign must match the rule''s kind. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.settle_occurrence(uuid, date, bigint, bigint, date) from public;
grant execute on function public.settle_occurrence(uuid, date, bigint, bigint, date) to authenticated;

-- ── unsettle_occurrence ──────────────────────────────────────────────────────
-- Puts a settled occurrence back to `projected`. An occurrence that was
-- hand-edited before it was settled (`is_overridden`) stays an edited
-- occurrence, carrying the settled figures as its edit, because those are the
-- most recent thing the user said about it. One that was not goes back to
-- the rule's own value; its `actual_*` are cleared, which is what
-- `occurrences_confirmed_has_actual_ck` allows once the status has moved.
--
-- The row is kept rather than deleted, even when nothing about it is
-- protected any more: the next `regenerate_occurrences` run owns unprotected
-- rows, and will rewrite or remove it exactly as it would any other.
create or replace function public.unsettle_occurrence(
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

  if v_occurrence.status <> 'confirmed' then
    raise sqlstate 'PT409' using message = 'this occurrence is not settled';
  end if;

  update public.occurrences
     set status = 'projected',
         actual_amount_cents = case when is_overridden then actual_amount_cents end,
         actual_date = case when is_overridden then actual_date end
   where id = v_occurrence.id
  returning * into v_occurrence;

  return v_occurrence;
end;
$$;

comment on function public.unsettle_occurrence(uuid, date) is
  'Takes back a settlement: the occurrence returns to projected, keeping its figures only if it had been hand-edited before it was settled. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.unsettle_occurrence(uuid, date) from public;
grant execute on function public.unsettle_occurrence(uuid, date) to authenticated;
