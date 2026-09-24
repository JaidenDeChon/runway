-- Issue #18, review follow-up: tighten what `public.recent_settled_amounts()`
-- counts, so the per-rule window holds only amounts the estimate can use.
--
-- A new migration rather than an edit to 20260924020000_income_prediction.sql,
-- because that one is already pushed (CLAUDE.md: migrations are forward-only
-- and applied exactly once). Same signature, so `database.types.ts` does not
-- change.
--
-- Two changes, both inside the ranking subquery:
--
-- 1. **Sign is filtered before ranking, not after.** The app turns a settled
--    amount into a magnitude by its rule's kind and drops any amount that
--    cannot be one (`domain/prediction.ts` `settledMagnitude`): a non-positive
--    income, a non-negative bill. Filtering only in the app meant such a row
--    still took one of the window's N places, pushing a valid older amount out
--    and, with two of them, sinking the rule below the two-amount minimum.
--    The app keeps its own filter as a second line.
-- 2. **Long-ended rules are left out.** Every apply-to-future split leaves a
--    closed rule behind, and without this the result grows by up to
--    `prediction_window` rows per split, forever, towards PostgREST's
--    `max_rows` (supabase/config.toml, 1000), past which rows are silently
--    dropped. A rule that ended more than 90 days ago projects nothing the app
--    can show — 90 is `MATERIALIZATION_LOOKBACK_DAYS` (domain/materialization.ts),
--    further back than any chart look-back — so its history is never read.
--    Rules that ended inside that window keep theirs, so a past stretch of the
--    chart does not change figure just because the rule behind it was split.
--    The bound is now `prediction_window` × (live rules + rules split in the
--    last 90 days) — 12 × 83 before it could bite, far past any household this
--    app models. `current_date` is the server's day, not the user's; at a
--    90-day margin a day either way does not matter.
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
        join public.recurring_rules r
          on r.id = o.rule_id
         and r.user_id = o.user_id
       where o.status = 'confirmed'
         and o.actual_amount_cents is not null
         and (r.ends_on is null or r.ends_on >= current_date - 90)
         and case r.kind
               when 'income' then o.actual_amount_cents > 0
               else o.actual_amount_cents < 0
             end
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
  'Each of the caller''s rules'' (live, or ended within 90 days) most recent settled (status = confirmed) occurrence amounts whose sign matches the rule''s kind, up to user_settings.prediction_window per rule, oldest first. Signed like projected_amount_cents. Scoped by RLS (security invoker); no user parameter.';

revoke all on function public.recent_settled_amounts() from public;
grant execute on function public.recent_settled_amounts() to authenticated;
