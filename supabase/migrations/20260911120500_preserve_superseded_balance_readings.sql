-- Teaches `save_account` and `save_account_balances`
-- (20260831011511_accounts_atomic_writes.sql) to preserve the reading they are
-- about to overwrite into `public.balance_readings`
-- (20260911120000_balance_readings.sql), before writing the new one over it.
--
-- Both are `create or replace function` with identical signatures and return
-- types, so existing grants and the RPC's callers are untouched — only the
-- body changes, and only by inserting one preserving statement ahead of the
-- update each already ran.
--
-- Skipped whenever the balance and as-of are not actually changing (a
-- name/colour-only edit through `save_account`, or resubmitting the same
-- day's figure through `save_account_balances`) — nothing was superseded, so
-- nothing needs preserving. `on conflict ... do nothing` covers the one case
-- that check does not: a reading already on file for that exact day, from an
-- earlier edit this same day.

-- ── save_account ─────────────────────────────────────────────────────────────
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
  v_previous public.accounts;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_id is null then
    insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
    values (v_user_id, p_name, p_color, p_balance_cents, p_balance_as_of)
    returning * into v_account;
  else
    -- Locked for the rest of this transaction: the row is about to be read
    -- and then overwritten, and nothing else in the function touches it in
    -- between, but a concurrent writer must not interleave with that pair.
    select * into v_previous
      from public.accounts
     where id = p_id
       and user_id = v_user_id
     for update;

    if not found then
      raise exception 'account not found';
    end if;

    if v_previous.balance_cents <> p_balance_cents or v_previous.balance_as_of <> p_balance_as_of then
      insert into public.balance_readings (user_id, account_id, balance_cents, as_of)
      values (v_user_id, p_id, v_previous.balance_cents, v_previous.balance_as_of)
      on conflict (user_id, account_id, as_of) do nothing;
    end if;

    update public.accounts
       set name = p_name,
           color = p_color,
           balance_cents = p_balance_cents,
           balance_as_of = p_balance_as_of
     where id = p_id
       and user_id = v_user_id
    returning * into v_account;
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
  'Inserts or updates one account and its discretionary-source designation in a single transaction, preserving the outgoing balance reading into balance_readings before overwriting it. user_id is derived from auth.uid(), never a parameter.';

-- ── save_account_balances ────────────────────────────────────────────────────
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

  insert into public.balance_readings (user_id, account_id, balance_cents, as_of)
  select v_user_id, a.id, a.balance_cents, a.balance_as_of
    from public.accounts a
    join unnest(p_account_ids, p_balance_cents) as v (account_id, balance_cents)
      on a.id = v.account_id
   where a.user_id = v_user_id
     and (a.balance_cents <> v.balance_cents or a.balance_as_of <> p_as_of)
  on conflict (user_id, account_id, as_of) do nothing;

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
  'Records a balance reading against p_as_of for every named account in one transaction, preserving each outgoing reading into balance_readings before overwriting it. user_id is derived from auth.uid(), never a parameter.';
