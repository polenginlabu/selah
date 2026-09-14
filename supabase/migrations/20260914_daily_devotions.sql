-- The daily devotional engine: one row per user per day. Written only by the
-- daily-devotion Edge Function (service role); the client may read and delete
-- its own rows (deleting today's row lets the user regenerate it).
--
-- trusted_teachers and questions are jsonb arrays so the engine can store
-- lists without needing extra tables; the shape is validated server-side by
-- the function before it is ever inserted.
create table if not exists public.daily_devotions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  topic text not null,             -- topic id, e.g. 'waiting'
  topic_label text not null,       -- display label, e.g. 'Waiting on God'
  title text not null,
  key_scripture text not null,     -- reference, e.g. 'Isaiah 40:31'
  key_scripture_text text not null,
  key_scripture_translation text not null default 'World English Bible',
  thought text not null,
  teaches text not null,
  trusted_teachers jsonb not null default '[]'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  application text not null,
  prayer text not null,
  selah text,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.daily_devotions is
  'A generated SELAH devotional for one user on one date.';

create unique index if not exists daily_devotions_user_date
  on public.daily_devotions (user_id, date);

alter table public.daily_devotions enable row level security;

create policy "Users read their own daily devotions"
  on public.daily_devotions
  for select
  using (auth.uid() = user_id);

create policy "Users delete their own daily devotions"
  on public.daily_devotions
  for delete
  using (auth.uid() = user_id);