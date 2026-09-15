-- One devotion per day for the whole app, instead of one per user.
--
-- Each devotion costs a multi-minute agent research run, so generating one per
-- user does not scale: 20 users meant 20 runs a night and 20x the model spend,
-- and anyone who signed up after the nightly job saw an empty card until the
-- next one. A single shared row costs one run regardless of how many people
-- read it, and a user who joins at noon sees today's devotion immediately.
--
-- Safe to run on the existing table: the policies that referenced user_id are
-- dropped first, then any duplicate dates are collapsed to the newest row so
-- the new unique index can be created.

-- 1. The old per-user policies reference user_id, so they must go first.
drop policy if exists "Users read their own daily devotions" on public.daily_devotions;
drop policy if exists "Users delete their own daily devotions" on public.daily_devotions;

-- 2. The per-user uniqueness constraint no longer applies.
drop index if exists public.daily_devotions_user_date;

-- 3. Collapse any duplicate dates, keeping the most recently created row.
delete from public.daily_devotions a
using public.daily_devotions b
where a.date = b.date
  and (a.created_at, a.id) < (b.created_at, b.id);

-- 4. The devotion belongs to the day, not to a person.
alter table public.daily_devotions drop column if exists user_id;

create unique index if not exists daily_devotions_date
  on public.daily_devotions (date);

comment on table public.daily_devotions is
  'One generated SELAH devotional per date, shared by every user.';

-- 5. Any signed-in user may read it; only the service role (the generator)
--    writes. No insert/update/delete policy exists, so RLS denies those to
--    everyone except the service role, which bypasses RLS by design.
drop policy if exists "Signed-in users read the daily devotion" on public.daily_devotions;
create policy "Signed-in users read the daily devotion"
  on public.daily_devotions
  for select
  to authenticated
  using (true);
