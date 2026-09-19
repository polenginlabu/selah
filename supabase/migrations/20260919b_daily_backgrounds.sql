-- One AI-generated background image per day, shared by every user.
--
-- The image itself lives in FIREBASE Storage, not Supabase Storage. Only the
-- metadata is here. That split is deliberate: Supabase is the application
-- database and its storage quota is reserved for user content, while the
-- generated media is bulk, immutable, CDN-served and cheap to keep somewhere
-- else. The app never needs Supabase to serve bytes — it reads image_url and
-- hands it to an <img>.
--
-- Shaped exactly like daily_devotions: one row per date, unique by date,
-- written only by the service role (the generator), readable by any signed-in
-- user. That is what makes the nightly job idempotent — a retry finds the row
-- and stops rather than paying for a second image.
--
-- Rows are kept forever rather than pruned to today's: the planned Background
-- Gallery ("today / yesterday / previous SELAH backgrounds") is just an
-- ordered select over this table, so nothing extra is needed to support it.

create table if not exists public.daily_backgrounds (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  storage_path text not null,
  image_url text not null,
  theme text not null,
  -- The exact prompt that produced this image. Kept so a background that comes
  -- out badly can be diagnosed, and so the theme rotation can be tuned against
  -- what actually ran rather than what we think ran.
  prompt text,
  model text,
  width integer,
  height integer,
  bytes integer,
  created_at timestamptz not null default now()
);

create unique index if not exists daily_backgrounds_date
  on public.daily_backgrounds (date);

-- The gallery reads newest-first. Small table (one row a day), but the index
-- costs nothing and keeps that query from degrading into a sort as it grows.
create index if not exists daily_backgrounds_date_desc
  on public.daily_backgrounds (date desc);

comment on table public.daily_backgrounds is
  'One generated background image per date, shared by every user. Image bytes live in Firebase Storage; only metadata is stored here.';
comment on column public.daily_backgrounds.storage_path is
  'Path inside the Firebase Storage bucket, e.g. selah/backgrounds/2026/09/19.webp';
comment on column public.daily_backgrounds.image_url is
  'Publicly readable download URL the browser puts in an <img> src.';

alter table public.daily_backgrounds enable row level security;

-- Any signed-in user may read any background — today's for the verse card, and
-- older ones for the gallery. No insert/update/delete policy exists, so RLS
-- denies writes to everyone except the service role, which bypasses RLS and is
-- what the nightly generator uses.
drop policy if exists "Signed-in users read daily backgrounds" on public.daily_backgrounds;
create policy "Signed-in users read daily backgrounds"
  on public.daily_backgrounds
  for select
  to authenticated
  using (true);
