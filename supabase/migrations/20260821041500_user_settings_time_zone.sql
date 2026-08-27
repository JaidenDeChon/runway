-- user_settings.time_zone — the user's calendar-day timezone override.
--
-- Nullable, and null is the default, because null means "follow whatever device
-- I am on". That is the right answer for almost everybody: "what day is it"
-- should follow the phone in your hand. The column exists for the people it is
-- wrong for — somebody working abroad who still budgets on home dates — and
-- because the answer has to be storable to survive the move from browser
-- storage to an account.
--
-- A zone resolved from a browser is deliberately NOT written here. It is a fact
-- about a device, and storing it would freeze the first device the user
-- happened to open the app on. What the user *chose* is data; what the browser
-- reported is not.
--
-- Stored as text rather than validated against pg_timezone_names: the IANA
-- database ships new zones with Postgres releases, so a check constraint or an
-- enum turns a tzdata update into a failing insert. The check below is the one
-- thing worth enforcing — an empty string is not a zone, and would silently
-- read as "set" on the way back out.
alter table public.user_settings
  add column time_zone text
    constraint user_settings_time_zone_not_blank
      check (time_zone is null or length(btrim(time_zone)) > 0);

comment on column public.user_settings.time_zone is
  'IANA timezone override for calendar-day arithmetic. Null means follow the device.';
