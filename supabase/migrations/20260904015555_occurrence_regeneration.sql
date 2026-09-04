-- Occurrence materialization (issue #9): reconciles public.occurrences with
-- the desired set domain/materialization.ts computes for a rule's window, in
-- one atomic, idempotent operation. See docs/database/schema.md, "The
-- regeneration contract", for the full write-up; this is that contract made
-- structural rather than just documented.
--
-- Two things land here. `private.protect_materialized_occurrence()` is a
-- trigger that makes "a protected row's projected_date/projected_amount_cents
-- never change" true for every writer, not just this one.
-- `public.regenerate_occurrences(...)` is the only writer this PR gives
-- `app/` — see tests/guards/occurrence-write-sites.test.ts.
--
-- A row is protected iff `is_overridden` or `status <> 'projected'`
-- (docs/database/schema.md). That predicate appears twice below — once on the
-- upsert's WHERE, once on the delete's WHERE — as the exact conjunct
-- `not is_overridden and status = 'projected'`. Any row satisfying protection
-- falsifies that conjunct, so it is excluded from both statements' result
-- sets as a property of the SQL itself, independent of what the caller passed.

-- ── the protection trigger ───────────────────────────────────────────────────
-- `private`, not `public` — docs/database/rls.md reserves `private` for
-- anything that must never be reachable through the API;
-- private.set_updated_at and private.normalize_recurring_rule_days
-- (20260819171405) are the precedents. `security invoker` and
-- `set search_path = ''` are stated for the reader, matching those, even
-- though a BEFORE UPDATE trigger runs as whoever issued the UPDATE regardless.
--
-- Confirmed safe against everything that updates `occurrences` today:
-- supabase/seed.sql's demo updates write status / actual_* / is_overridden
-- only, and tests/rls/domain-tables.test.ts's occurrence probe updates
-- status. None touch projected_date or projected_amount_cents.
create or replace function private.protect_materialized_occurrence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.projected_date is distinct from old.projected_date then
    raise exception 'occurrences.projected_date is written by generation and is immutable'
      using errcode = '23514';
  end if;
  if (old.is_overridden or old.status <> 'projected')
     and new.projected_amount_cents is distinct from old.projected_amount_cents then
    raise exception 'a protected occurrence keeps its projected amount'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_materialized_occurrence() from public;

-- Trigger name sorts before occurrences_set_updated_at, so it fires first.
-- That ordering is incidental, not load-bearing: this trigger only ever
-- raises or passes new through unchanged.
create trigger occurrences_protect_materialized
  before update on public.occurrences
  for each row execute function private.protect_materialized_occurrence();

-- ── regenerate_occurrences ───────────────────────────────────────────────────
-- Applies a caller-computed desired set to the caller's own rules inside a
-- window: upserts unprotected rows toward it, deletes unprotected rows that
-- fell out of it, and never touches a protected row either way.
--
-- The desired set is computed in TypeScript (domain/materialization.ts),
-- through occurrenceDates — the only correct cadence expander. A pure-SQL
-- generator was rejected: Postgres' generate_series(d, ..., interval
-- '1 month') is sticky (Jan 31 -> Feb 28 -> Mar 28) while addMonthsClamped is
-- not (-> Mar 31); supabase/seed.sql already carries the scar from finding
-- that once. This function only ever applies a set it is handed.
--
-- `p_rule_ids` scopes the delete to the rules the caller is regenerating —
-- passing every rule the household owns is how the horizon top-up covers the
-- whole calendar; passing one rule's id is how saving that rule stays cheap.
-- The three `p_occurrence_*` arrays are parallel and index-aligned
-- (app/lib/supabase/occurrences.ts toRegenerationArgs guarantees this) and
-- together are the desired set: every occurrence any rule in scope produces
-- inside [p_window_start, p_window_end].
create or replace function public.regenerate_occurrences(
  p_rule_ids uuid[],
  p_window_start date,
  p_window_end date,
  p_occurrence_rule_ids uuid[],
  p_occurrence_dates date[],
  p_occurrence_amount_cents bigint[]
)
returns table (upserted integer, deleted integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_rule_ids uuid[] := coalesce(p_rule_ids, '{}'::uuid[]);
  v_o_rules uuid[] := coalesce(p_occurrence_rule_ids, '{}'::uuid[]);
  v_o_dates date[] := coalesce(p_occurrence_dates, '{}'::date[]);
  v_o_cents bigint[] := coalesce(p_occurrence_amount_cents, '{}'::bigint[]);
  v_upserted integer := 0;
  v_deleted integer := 0;
  v_out_of_window date;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if array_length(v_o_rules, 1) is distinct from array_length(v_o_dates, 1)
     or array_length(v_o_rules, 1) is distinct from array_length(v_o_cents, 1) then
    raise exception
      'p_occurrence_rule_ids, p_occurrence_dates and p_occurrence_amount_cents must be the same length';
  end if;

  if p_window_end < p_window_start then
    raise exception 'p_window_end must not precede p_window_start';
  end if;

  -- A sanity bound in the same spirit as default_horizon_days' 1..730 check
  -- (20260819171405) — the app asks for 455 days (90 back, 365 forward).
  if p_window_end - p_window_start > 1830 then
    raise exception 'the regeneration window must not exceed 1830 days';
  end if;

  -- A date the caller offers outside its own window is a row the delete below
  -- could never subsequently clean up, because the delete is bounded by the
  -- window on purpose (see the comment on it). Raise rather than silently
  -- filter, so a caller that computed the window wrong hears about it instead
  -- of quietly leaking a row past the horizon.
  select d into v_out_of_window
    from unnest(v_o_dates) as d
   where d < p_window_start or d > p_window_end
   limit 1;

  if v_out_of_window is not null then
    raise exception 'an offered occurrence date falls outside the regeneration window';
  end if;

  with desired as (
    -- The desired set is unique on (rule_id, projected_date) by construction
    -- — occurrenceDates de-duplicates within a rule, and rule ids are
    -- distinct — but `distinct on` guards it defensively: two rows sharing a
    -- key in one command raise "ON CONFLICT DO UPDATE command cannot affect
    -- row a second time" (21000), verified empirically against this function.
    select distinct on (u.rule_id, u.projected_date)
           u.rule_id, u.projected_date, u.projected_amount_cents
      from unnest(v_o_rules, v_o_dates, v_o_cents)
             as u (rule_id, projected_date, projected_amount_cents)
     order by u.rule_id, u.projected_date
  )
  insert into public.occurrences
         (user_id, account_id, rule_id, projected_date, projected_amount_cents)
  select v_user_id, r.account_id, d.rule_id, d.projected_date, d.projected_amount_cents
    from desired d
    -- r.user_id = v_user_id holds even for a BYPASSRLS caller, on top of
    -- whatever RLS already filtered recurring_rules to — so a rule id
    -- belonging to somebody else simply produces no row here, structurally,
    -- not by policy alone.
    join public.recurring_rules r
      on r.id = d.rule_id and r.user_id = v_user_id
  on conflict on constraint occurrences_rule_projected_date_key
  do update set projected_amount_cents = excluded.projected_amount_cents
   where not public.occurrences.is_overridden
     and public.occurrences.status = 'projected'
     -- `is distinct from` is what makes "running it twice changes nothing"
     -- literally true: without it, every no-op run would rewrite every row
     -- and bump updated_at through occurrences_set_updated_at. Verified: an
     -- offered row matching what is stored reports INSERT 0 0, not 0 1.
     and public.occurrences.projected_amount_cents
         is distinct from excluded.projected_amount_cents;
  get diagnostics v_upserted = row_count;

  -- Guarded delete: only unprotected rows, only inside the window, only for
  -- rules in scope, only when absent from the desired set. Past occurrences
  -- are retained as history because this predicate is what does it — a row
  -- that has fallen out of the back of the window as `today` advanced is not
  -- in this delete's result set at all, regardless of protection. That is the
  -- whole mechanism; a later "tidy the predicate" edit that drops the
  -- projected_date bound would silently start eating history on every top-up.
  delete from public.occurrences o
   where o.user_id = v_user_id
     and o.rule_id = any (v_rule_ids)
     and o.projected_date between p_window_start and p_window_end
     and not o.is_overridden
     and o.status = 'projected'
     and not exists (
       select 1
         from unnest(v_o_rules, v_o_dates) as d (rule_id, projected_date)
        where d.rule_id = o.rule_id and d.projected_date = o.projected_date
     );
  get diagnostics v_deleted = row_count;

  return query select v_upserted, v_deleted;
end;
$$;

comment on function public.regenerate_occurrences(uuid[], date, date, uuid[], date[], bigint[]) is
  'Regenerates materialized occurrences for the caller''s own rules inside a window. Protected rows (is_overridden, or status <> ''projected'') are never updated and never deleted. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.regenerate_occurrences(uuid[], date, date, uuid[], date[], bigint[]) from public;
grant execute on function public.regenerate_occurrences(uuid[], date, date, uuid[], date[], bigint[]) to authenticated;
