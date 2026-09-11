-- A history of superseded balance readings, so a new one moves the chart from
-- its own day forward instead of rewriting what an earlier reading already
-- produced for the days before it.
--
-- `public.accounts.balance_cents`/`balance_as_of` still holds the *current*
-- reading — every existing reader keeps working unchanged — but until now that
-- was the only reading an account could ever have: `save_account` and
-- `save_account_balances` overwrote it in place, so the value it replaced was
-- gone. `domain/projection.ts`'s `integrate` walks *backward* from that single
-- anchor to fill days before it, subtracting known deltas as it goes — correct
-- for a chart's look-back window with nothing else to go on, but wrong the
-- moment a day it is backward-computing already had its own, different,
-- previously-recorded reading: an unmodelled deposit or a stray cash purchase
-- between the two readings means the backward guess disagrees with what was
-- true, and the account's whole history silently reshapes around the new
-- number.
--
-- This table is where the *outgoing* value goes the moment it is about to be
-- overwritten, in a follow-up migration to the two RPCs
-- (20260831011511_accounts_atomic_writes.sql). `domain/projection.ts`'s
-- `readingsFor` then walks every account's readings oldest first, and only the
-- oldest is allowed to back-fill; every later one only overwrites forward from
-- its own day. See docs/engine/README.md.
--
-- `unique (user_id, account_id, as_of)` is the natural key: a day can only
-- have one true balance, so a second reading recorded for a day already on
-- file replaces it rather than producing an ambiguous pair. It also covers the
-- RLS-predicate need for `user_id` alone, being its leading column.
create table public.balance_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,
  balance_cents bigint not null,
  as_of date not null,
  created_at timestamptz not null default now(),
  constraint balance_readings_account_fk
    foreign key (user_id, account_id)
    references public.accounts (user_id, id) on delete cascade,
  constraint balance_readings_unique_reading
    unique (user_id, account_id, as_of)
);

comment on table public.balance_readings is
  'Balance readings an account has since moved past, kept so a later reading can never rewrite what an earlier one already produced for the days before it. The account''s own balance_cents/balance_as_of remains the current reading; this table holds everything superseded.';

-- Redundant locally (the event trigger in 20260817020810 already did it),
-- essential if that trigger was refused on a hosted push. Always written.
alter table public.balance_readings enable row level security;

-- No separate user_id index: `balance_readings_unique_reading` already leads
-- with user_id, so that index IS the RLS-predicate index. See
-- docs/database/rls.md's checklist, which names this case explicitly.

grant select, insert, update, delete on public.balance_readings to authenticated;

create policy balance_readings_select_own on public.balance_readings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy balance_readings_insert_own on public.balance_readings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy balance_readings_update_own on public.balance_readings
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy balance_readings_delete_own on public.balance_readings
  for delete to authenticated using ((select auth.uid()) = user_id);
