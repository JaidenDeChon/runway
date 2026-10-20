-- Puts back the occurrences PR #95's deploy preview marked paid or received.
--
-- PR #95 (closed unmerged; ADR 0003) added `settle_occurrence()`, and its
-- preview ran against the hosted database from 2026-10-17 until
-- 20261017120000_remove_income_prediction dropped the function. Any
-- occurrence settled through that preview is still a `status = 'confirmed'`
-- row on hosted. 20261017120000 left those rows alone as inert, but they are
-- not: `override_occurrence` and `revert_occurrence`
-- (20260913090000_occurrence_overrides_and_rule_split) refuse any row whose
-- status is not `projected` with PT409, so each one is an occurrence the day
-- editor and the Upcoming list can no longer edit or revert. "Could not save
-- that change" is all the user would see.
--
-- This does exactly what PR #95's own `unsettle_occurrence` did: the row
-- returns to `projected`; one that was hand-edited before it was settled keeps
-- its figures as that edit, and one that was not has them cleared, so the
-- next regeneration owns it again like any other unprotected row.
-- `projected_date` and `projected_amount_cents` are not touched, so
-- `private.protect_materialized_occurrence()` has nothing to object to.
--
-- Every confirmed row on hosted came from that preview: nothing on `main` has
-- ever written `status = 'confirmed'`, the test suites refuse a non-loopback
-- database (tests/support/stack.ts), and `supabase/seed.sql` is not applied
-- by `db push`. On a fresh local database or in CI this runs before the seed,
-- against an empty table, and changes nothing. On a local stack that already
-- holds the seed, `migration up` resets the seed's one demonstration
-- `confirmed` row (Electric & water, 2026-08-28); `bun run db:reset` puts it
-- back.
--
-- One-off and data-only: no function, no schema change. When reconciliation
-- (#26) records confirmed rows for real, it does so after this has run, and
-- nothing here applies to them.

update public.occurrences
   set status = 'projected',
       actual_amount_cents = case when is_overridden then actual_amount_cents end,
       actual_date = case when is_overridden then actual_date end
 where status = 'confirmed';
