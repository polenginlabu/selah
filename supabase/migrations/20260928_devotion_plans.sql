-- Devotional plans: a curated set of pre-made 7-day plans, one per theme, plus
-- per-user progress.
--
-- A plan is a catalog row with a fixed sequence of themed days
-- (devotion_plan_days); the reader client resolves each day to the newest
-- archived devotion with that theme (or falls back to today's when none exists).
--
-- The catalog is shared like daily_devotions — any signed-in user reads it,
-- only the service role writes (the seed below runs as the migration's owner,
-- which bypasses RLS). Progress is the only per-user table: one row per
-- user/plan holding the set of completed day numbers, so completion follows the
-- reader across devices. Cross-device writes are last-write-wins (the same
-- tradeoff as reading_positions and bible_highlights).
--
-- Same conventions as 20260923_bible_highlights.sql: RLS enabled, auth.uid()
-- policies, FK cascade deletes, an updated_at touch trigger, and a validation
-- trigger on the array column so a buggy or hostile client cannot stuff junk
-- into progress that every device then re-reads.

-- --- Catalog ----------------------------------------------------------------

create table if not exists public.devotion_plans (
  id bigint generated always as identity primary key,
  slug text not null unique,
  title text not null,
  description text not null default '',
  day_count smallint not null default 7 check (day_count between 1 and 30)
);

comment on table public.devotion_plans is
  'Curated devotional plans. Shared by every user, like daily_devotions.';

create table if not exists public.devotion_plan_days (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.devotion_plans(id) on delete cascade,
  day_number smallint not null check (day_number >= 1),
  theme text not null,
  title text,
  unique (plan_id, day_number)
);

comment on table public.devotion_plan_days is
  'One fixed theme per plan day; the reader resolves it to the newest archived devotion with that theme.';

-- Any signed-in user reads the catalog; nobody writes it from the client.
alter table public.devotion_plans enable row level security;
alter table public.devotion_plan_days enable row level security;

drop policy if exists "Signed-in users read the devotion plans" on public.devotion_plans;
create policy "Signed-in users read the devotion plans"
  on public.devotion_plans
  for select
  to authenticated
  using (true);

drop policy if exists "Signed-in users read the devotion plan days" on public.devotion_plan_days;
create policy "Signed-in users read the devotion plan days"
  on public.devotion_plan_days
  for select
  to authenticated
  using (true);

-- --- Seed: one 7-day plan per theme -----------------------------------------
--
-- Idempotent: inserts only fill gaps (on conflict do nothing), never delete or
-- rewrite, so this migration can be re-run and future catalog edits survive.

insert into public.devotion_plans (slug, title, description, day_count)
select v.slug, v.title, v.description, 7
from (values
  ('peace',
   'Peace: 7 Days of Stillness',
   'Seven days of stillness — let God quiet the noise and teach you to rest in His presence.'),
  ('joy',
   'Joy: 7 Days of Celebration',
   'Seven days of rejoicing — recapture the gladness that comes from the Lord, not from circumstances.'),
  ('hope',
   'Hope: 7 Days of Expectation',
   'Seven days of expectation — anchor your soul in the God who keeps every promise.'),
  ('faith',
   'Faith: 7 Days of Trust',
   'Seven days of trust — practice believing before you see.'),
  ('gratitude',
   'Gratitude: 7 Days of Thanks',
   'Seven days of thanks — train your heart to count what God has already given.'),
  ('rest',
   'Rest: 7 Days of Sabbath',
   'Seven days of sabbath rest — release striving and let God renew your strength.'),
  ('courage',
   'Courage: 7 Days of Strength',
   'Seven days of strength — stand firm in the One who goes before you.')
) as v(slug, title, description)
on conflict (slug) do nothing;

insert into public.devotion_plan_days (plan_id, day_number, theme, title)
select p.id, n.day_number, p.slug, format('%s · Day %s', labels.label, n.day_number)
from public.devotion_plans p
join (values
  ('peace', 'Peace'),
  ('joy', 'Joy'),
  ('hope', 'Hope'),
  ('faith', 'Faith'),
  ('gratitude', 'Gratitude'),
  ('rest', 'Rest'),
  ('courage', 'Courage')
) as labels(slug, label) on labels.slug = p.slug
cross join generate_series(1, p.day_count) as n(day_number)
on conflict (plan_id, day_number) do nothing;

-- --- Progress (per-user) ----------------------------------------------------

create table if not exists public.devotion_plan_progress (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id bigint not null references public.devotion_plans(id) on delete cascade,
  completed_days smallint[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, plan_id)
);

comment on table public.devotion_plan_progress is
  'Per-user devotional plan progress: the set of completed day numbers per plan.';

alter table public.devotion_plan_progress enable row level security;

drop policy if exists "Users manage their own plan progress" on public.devotion_plan_progress;
create policy "Users manage their own plan progress"
  on public.devotion_plan_progress
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_devotion_plan_progress_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists devotion_plan_progress_touch_updated_at on public.devotion_plan_progress;
create trigger devotion_plan_progress_touch_updated_at
  before update on public.devotion_plan_progress
  for each row execute function public.touch_devotion_plan_progress_updated_at();

-- Completed days must be positive day numbers inside the supported range
-- (plans are capped at 30 days). Clients compute these from the real plan, so
-- this only defends against a corrupted or hostile row.
create or replace function public.validate_devotion_plan_progress_days()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  foreach n in array new.completed_days loop
    if n < 1 or n > 30 then
      raise exception 'devotion_plan_progress.completed_days values must be day numbers between 1 and 30, got %', n;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists devotion_plan_progress_validate_days on public.devotion_plan_progress;
create trigger devotion_plan_progress_validate_days
  before insert or update on public.devotion_plan_progress
  for each row execute function public.validate_devotion_plan_progress_days();