-- Personal prayer list with a daily prayer checklist.
--
-- Three tables follow the house conventions from bible_highlights and
-- reading_positions: uuid ids, auth.uid() RLS policies on every row, an
-- updated_at touch trigger, and a validation trigger for the jsonb
-- recurrence column. Prayer data is private by design — all three tables are
-- fully owned by auth.uid(), and nothing here touches the community tables
-- (prayer_requests / prayer_supporters), which stay as they are.
--
-- "Today's prayers" is never materialized as rows. The client computes the
-- checklist from each item's recurrence rule and the user's LOCAL date (see
-- src/lib/prayerSchedule.js), and completing a prayer writes one row to
-- prayer_activity keyed by the unique (user, item, local date) triple.
-- Repeated page loads and repeated completes are therefore idempotent, and a
-- prayer completed at 11:50 PM belongs to that user's day, not UTC's.

create table if not exists public.prayer_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text,
  icon text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prayer_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.prayer_categories(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text,
  notes text,
  -- { "type": "daily" | "never" | "weekdays" | "weekly" | "custom",
  --   "days": [0..6] } — days is required for weekly/custom. Validated by the
  -- validate_prayer_item_recurrence trigger below, mirrored client-side in
  -- src/lib/prayerSchedule.js so the UI can never submit an invalid rule.
  recurrence jsonb not null default '{"type":"daily"}'::jsonb,
  sort_order int not null default 0,
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prayer_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prayer_item_id uuid not null references public.prayer_items(id) on delete cascade,
  prayer_date date not null,
  status text not null default 'prayed' check (status in ('prayed', 'skipped')),
  completed_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  -- The idempotency key: one activity row per user per item per local day.
  -- Re-completing or re-saving upserts in place instead of duplicating.
  unique (user_id, prayer_item_id, prayer_date)
);

alter table public.prayer_categories enable row level security;
alter table public.prayer_items enable row level security;
alter table public.prayer_activity enable row level security;

create policy "Users manage their own prayer categories"
  on public.prayer_categories
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own prayer items"
  on public.prayer_items
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.prayer_categories c
      where c.id = category_id and c.user_id = auth.uid()
    )
  );

create policy "Users manage their own prayer activity"
  on public.prayer_activity
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.prayer_items i
      where i.id = prayer_item_id and i.user_id = auth.uid()
    )
  );

create index prayer_categories_user_order_idx on public.prayer_categories (user_id, sort_order, created_at);
create index prayer_items_user_category_order_idx on public.prayer_items (user_id, category_id, sort_order, created_at);
create index prayer_activity_user_date_idx on public.prayer_activity (user_id, prayer_date desc);

-- Recurrence validation -------------------------------------------------------
create or replace function public.validate_prayer_item_recurrence()
returns trigger
language plpgsql
as $$
declare
  rtype text;
  day_val record;
begin
  if jsonb_typeof(new.recurrence) <> 'object' then
    raise exception 'prayer_items.recurrence must be a JSON object';
  end if;

  rtype := new.recurrence ->> 'type';
  if rtype is null or rtype not in ('daily', 'never', 'weekdays', 'weekly', 'custom') then
    raise exception 'prayer_items.recurrence has an unknown type: %', rtype;
  end if;

  if new.recurrence ? 'days' then
    if jsonb_typeof(new.recurrence -> 'days') <> 'array' then
      raise exception 'prayer_items.recurrence.days must be an array of weekdays 0..6';
    end if;
    for day_val in select value from jsonb_array_elements(new.recurrence -> 'days') loop
      if jsonb_typeof(day_val.value) <> 'number' or not (day_val.value #>> '{}') ~ '^[0-6]$' then
        raise exception 'prayer_items.recurrence.days must contain integers 0..6 (Sunday = 0)';
      end if;
    end loop;
  end if;

  if rtype in ('weekly', 'custom') and not (new.recurrence ? 'days') then
    raise exception 'prayer_items.recurrence.% requires a days array', rtype;
  end if;

  return new;
end;
$$;

drop trigger if exists prayer_items_validate_recurrence on public.prayer_items;
create trigger prayer_items_validate_recurrence
  before insert or update on public.prayer_items
  for each row execute function public.validate_prayer_item_recurrence();

-- updated_at touch triggers (house pattern) -----------------------------------
create or replace function public.touch_prayer_categories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prayer_categories_touch_updated_at on public.prayer_categories;
create trigger prayer_categories_touch_updated_at
  before update on public.prayer_categories
  for each row execute function public.touch_prayer_categories_updated_at();

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

create or replace function public.touch_prayer_activity_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prayer_activity_touch_updated_at on public.prayer_activity;
create trigger prayer_activity_touch_updated_at
  before update on public.prayer_activity
  for each row execute function public.touch_prayer_activity_updated_at();