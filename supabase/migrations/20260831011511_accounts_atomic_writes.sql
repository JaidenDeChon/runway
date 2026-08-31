-- Two RPCs replace the client-side multi-request writes in
-- `app/composables/useRunwayData.ts` `saveAccount` and `saveBalances`, closing
-- an adversarial-review finding: an account insert and the discretionary
-- `user_settings` update that follows it were two separate PostgREST requests,
-- so a failure in the second left a committed, orphaned account row behind —
-- and because `saveAccount`'s caller never learned the new id, pressing the
-- button again inserted a *second* row. `saveBalances` had the same shape
-- across N accounts instead of two statements.
--
-- A PL/pgSQL function body is a single transaction, so wrapping each pair (or
-- N-way) write in one gives "both/all writes land, or none do" without any
-- client-side retry bookkeeping, which would still leave the first write
-- committed.
--
-- `security invoker`, not `security definer`: the caller must remain
-- `authenticated` for RLS to evaluate as *them*, never as the function's
-- owner. `set search_path = ''` with every name schema-qualified, per
-- docs/database/rls.md. Both functions live in `public` — the one legitimate
-- reason, per that same doc, being that only `public` is reachable through
-- PostgREST — and each needs its own explicit `grant execute ... to
-- authenticated`, because 20260817020810_deny_by_default_privileges.sql
-- revokes EXECUTE on every new public function from PUBLIC. Nothing is
-- granted to anon.
--
-- `user_id` is never a parameter of either function. Both derive it from
-- `(select auth.uid())` and use it as the only predicate that decides which
-- rows a call can touch — the same non-negotiable CLAUDE.md and docs/auth.md
-- state for every Nitro handler, extended here to a database function.

-- ── save_account ─────────────────────────────────────────────────────────────
-- Inserts (p_id null) or updates (p_id set) one account, then re-establishes
-- the one-source discretionary invariant on user_settings, atomically. Mirrors
-- the two branches `saveAccount` used to run as separate requests.
create or replace function public.save_account(
  p_id uuid,
  p_name text,
  p_color text,
  p_balance_cents bigint,
  p_balance_as_of date,
  p_is_discretionary_source boolean
)
returns public.accounts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_account public.accounts;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_id is null then
    insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
    values (v_user_id, p_name, p_color, p_balance_cents, p_balance_as_of)
    returning * into v_account;
  else
    update public.accounts
       set name = p_name,
           color = p_color,
           balance_cents = p_balance_cents,
           balance_as_of = p_balance_as_of
     where id = p_id
       and user_id = v_user_id
    returning * into v_account;

    if not found then
      raise exception 'account not found';
    end if;
  end if;

  -- Same stance as the code this replaces: the flag is cleared, never
  -- reassigned, when it is turned off. Leaving the household with no
  -- discretionary source is legal; silently moving the drain to another
  -- account would be a change the user did not make.
  if p_is_discretionary_source then
    update public.user_settings
       set discretionary_account_id = v_account.id
     where user_id = v_user_id;
  else
    update public.user_settings
       set discretionary_account_id = null
     where user_id = v_user_id
       and discretionary_account_id = v_account.id;
  end if;

  return v_account;
end;
$$;

comment on function public.save_account(uuid, text, text, bigint, date, boolean) is
  'Inserts or updates one account and its discretionary-source designation in a single transaction. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.save_account(uuid, text, text, bigint, date, boolean) from public;
grant execute on function public.save_account(uuid, text, text, bigint, date, boolean) to authenticated;

-- ── save_account_balances ────────────────────────────────────────────────────
-- Records a balance reading against `p_as_of` for every account named in
-- `p_account_ids`, in one statement rather than one request per account, so a
-- failure partway through cannot leave some accounts updated and others not —
-- and so the dashboard can never be left projecting from a mix of old and new
-- anchors. Unknown or foreign ids simply match no row via the `user_id`
-- predicate; the caller (`useRunwayData`) already filters to active ids
-- belonging to the signed-in household before calling this.
create or replace function public.save_account_balances(
  p_account_ids uuid[],
  p_balance_cents bigint[],
  p_as_of date
)
returns setof public.accounts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if coalesce(array_length(p_account_ids, 1), 0) <> coalesce(array_length(p_balance_cents, 1), 0) then
    raise exception 'p_account_ids and p_balance_cents must be the same length';
  end if;

  update public.accounts a
     set balance_cents = v.balance_cents,
         balance_as_of = p_as_of
    from unnest(p_account_ids, p_balance_cents) as v (account_id, balance_cents)
   where a.id = v.account_id
     and a.user_id = v_user_id;

  return query
    select *
      from public.accounts
     where user_id = v_user_id
       and id = any (p_account_ids);
end;
$$;

comment on function public.save_account_balances(uuid[], bigint[], date) is
  'Records a balance reading against p_as_of for every named account in one transaction. user_id is derived from auth.uid(), never a parameter.';

revoke all on function public.save_account_balances(uuid[], bigint[], date) from public;
grant execute on function public.save_account_balances(uuid[], bigint[], date) to authenticated;
