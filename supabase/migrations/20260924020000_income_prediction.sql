-- Issue #18: income prediction from history.
--
-- Three changes, one issue:
--
-- 1. `user_settings.prediction_window` — how many of a rule's most recent
--    settled occurrences its estimate averages over. A user choice, so it is
--    stored (CLAUDE.md: what the user chose is data).
-- 2. `public.recent_settled_amounts()` — the read the app builds
--    `RecurringItem.depositHistory` from: each rule's last `prediction_window`
--    `status = 'confirmed'` occurrences. `docs/database/schema.md` has always
--    named this derivation ("`occurrences.actual_amount_cents where status =
--    'confirmed'`"); this is the first thing that reads it.
-- 3. `public.split_recurring_rule` redefined so that apply-to-future *pins*
--    the amount it was given: the successor (or the in-place rule) becomes
--    `amount_source = 'fixed'`, `is_variable = false`. Without this, an
--    in-place split keeps its rule id — and therefore its settled history —
--    and the estimate would immediately paint over the amount the user just
--    typed, breaking the issue's "a user edit overrides the prediction and
--    stays overridden".
--
-- Forward-only: 20260913090000_occurrence_overrides_and_rule_split.sql is
-- pushed and is not edited; `create or replace` here supersedes its body.

-- ── 1. prediction_window ─────────────────────────────────────────────────────
-- Lower bound 2 matches `domain/prediction.ts` `MIN_DEPOSITS_FOR_PREDICTION`:
-- a window of 1 would "average" a single deposit, which is not an estimate
-- but a copy of last month. Upper bound 12 is a year of monthly deposits —
-- far enough back that seasonality (out of scope for #18) starts to matter
-- more than the mean does. Default 3 is the figure the design's own copy
-- uses ("Predicted from your last 3 deposits").
alter table public.user_settings
  add column prediction_window smallint not null default 3
    constraint user_settings_prediction_window_ck
      check (prediction_window between 2 and 12);

comment on column public.user_settings.prediction_window is
  'How many of a rule''s most recent settled (confirmed) occurrences its estimate averages over. 2..12, default 3.';

-- ── 2. recent_settled_amounts ────────────────────────────────────────────────
-- `security invoker`, so RLS on `occurrences` and `user_settings` is what
-- scopes this to the caller: there is no user parameter to forge, and a
-- caller cannot see another user's rows through it any more than through a
-- direct select. The window is read from the caller's own settings row
-- rather than passed in, so the app's household read can issue this in
-- parallel with its settings read instead of after it; `coalesce(..., 3)`
-- covers a missing settings row (the column default, restated).
--
-- Why a function rather than a plain `.from('occurrences')` read: the app
-- needs the last N *per rule*, and PostgREST cannot express a per-group
-- limit. Reading every confirmed row instead would grow without bound and
-- eventually hit `max_rows` (supabase/config.toml), silently truncating the
-- history of whichever rules sort last.
create or replace function public.recent_settled_amounts()
returns table (rule_id uuid, projected_date date, actual_amount_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select ranked.rule_id, ranked.projected_date, ranked.actual_amount_cents
    from (
      select o.rule_id,
             o.projected_date,
             o.actual_amount_cents,
             row_number() over (
               partition by o.rule_id
               order by o.projected_date desc
             ) as recency
        from public.occurrences o
       where o.status = 'confirmed'
         and o.actual_amount_cents is not null
    ) ranked
   where ranked.recency <= coalesce(
           (select s.prediction_window
              from public.user_settings s
             where s.user_id = (select auth.uid())),
           3
         )
   order by ranked.rule_id, ranked.projected_date;
$$;

comment on function public.recent_settled_amounts() is
  'Each of the caller''s rules'' most recent settled (status = confirmed) occurrence amounts, up to user_settings.prediction_window per rule, oldest first. Signed like projected_amount_cents. Scoped by RLS (security invoker); no user parameter.';

revoke all on function public.recent_settled_amounts() from public;
grant execute on function public.recent_settled_amounts() to authenticated;

-- ── 3. split_recurring_rule: apply-to-future pins the amount ─────────────────
-- Body identical to 20260913090000 apart from the two marked lines. See that
-- migration for every other comment; they still hold.
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
    update public.recurring_rules
       set amount_cents = p_amount_cents,
           -- #18: the typed amount is the amount. Left 'predicted' (or
           -- variable), this rule keeps its id and so its settled history,
           -- and the estimate would replace what the user just typed.
           amount_source = 'fixed',
           is_variable = false
     where id = v_rule.id
       and user_id = v_user_id;

    return query select null::uuid, v_rule.id;
    return;
  end if;

  update public.recurring_rules
     set ends_on = p_effective_from - 1
   where id = v_rule.id
     and user_id = v_user_id;

  insert into public.recurring_rules
         (user_id, account_id, name, kind, amount_cents, amount_source, is_variable,
          cadence, days_of_month, days_of_week, anchor_date, starts_on, ends_on)
  -- #18: 'fixed' / false rather than inheriting v_rule's, for the same reason
  -- as the in-place branch — an explicit forward amount is not an estimate.
  values (v_user_id, v_rule.account_id, v_rule.name, v_rule.kind, p_amount_cents,
          'fixed', false, v_rule.cadence, v_rule.days_of_month,
          v_rule.days_of_week, p_effective_from, p_effective_from, v_rule.ends_on)
  returning id into v_successor_id;

  return query select v_rule.id, v_successor_id;
end;
$$;

comment on function public.split_recurring_rule(uuid, date, bigint) is
  'Closes a recurring rule the day before p_effective_from and opens a successor at the new amount from that day forward ("apply to all future"). The successor (or the in-place rule) is pinned: amount_source = fixed, is_variable = false. Amount-only: retiming a day-set rule is out of scope. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.split_recurring_rule(uuid, date, bigint) from public;
grant execute on function public.split_recurring_rule(uuid, date, bigint) to authenticated;
