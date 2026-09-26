-- Personal prayer list — a flat daily checklist.
--
-- Two tables follow the house conventions from bible_highlights and
-- reading_positions: uuid ids, auth.uid() RLS policies on every row, and an
-- updated_at touch trigger where updates occur. Prayer data is private by
-- design — both tables are fully owned by auth.uid(), and nothing here
-- touches the community tables (prayer_requests / prayer_supporters), which
-- stay as they are.
--
-- "Today's prayers" is never materialized as rows, and every prayer the user
-- added is due every day. The client computes the checklist from the user's
-- LOCAL date (see src/lib/prayerDay.js), and completing a prayer writes one
-- row to prayer_activity keyed by the unique (user, item, local date) triple.
-- Repeated page loads and repeated completes are therefore idempotent, and a
-- prayer completed at 11:50 PM belongs to that user's day, not UTC's. A new
-- local day has no activity rows, so every prayer shows up unchecked again.
--
-- Applied-state guard (Path A vs Path B): this file is the fresh-database
-- variant. If the three-table prayer schema is already live on the target
-- (it is on this project — its `create policy` collided with the existing
-- "Users manage their own prayer items" policy), applying this file fails.
-- Run supabase/migrations/20260927_prayer_simplify.sql (Path B) instead.
do $$
begin
  if to_regclass('public.prayer_categories') is not null then
    raise exception 'Old prayer schema is already applied (prayer_categories exists). Run 20260927_prayer_simplify.sql (Path B) instead of this file.';
  end if;
end;
$$;

create table if not exists public.prayer_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prayer_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prayer_item_id uuid not null references public.prayer_items(id) on delete cascade,
  prayer_date date not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- The idempotency key: one activity row per user per item per local day.
  -- Re-completing or re-saving upserts in place instead of duplicating.
  unique (user_id, prayer_item_id, prayer_date)
);

alter table public.prayer_items enable row level security;
alter table public.prayer_activity enable row level security;

create policy "Users manage their own prayer items"
  on public.prayer_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own prayer activity"
  on public.prayer_activity
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index prayer_items_user_order_idx on public.prayer_items (user_id, sort_order, created_at);
create index prayer_activity_user_date_idx on public.prayer_activity (user_id, prayer_date desc);

-- updated_at touch trigger (house pattern) -----------------------------------
-- prayer_activity rows are only inserted, deleted or upserted (no general
-- updates), so only prayer_items needs the trigger.
create or replace function public.touch_prayer_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prayer_items_touch_updated_at on public.prayer_items;
create trigger prayer_items_touch_updated_at
  before update on public.prayer_items
  for each row execute function public.touch_prayer_items_updated_at();