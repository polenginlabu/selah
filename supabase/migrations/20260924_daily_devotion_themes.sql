-- Daily devotions get a curated theme (Peace, Hope, Faith, ...).
--
-- The nightly generator draws one at random from its palette when the admin
-- has not pinned a theme, and stores it here so the reader can show it and a
-- future archive page can filter/sort by it. The theme is a category ("hope");
-- topic/topic_label stays the agent's specific angle within it ("Waiting on
-- God"), so the two coexist.
--
-- Nullable: rows generated before this migration carry no theme, and the UI
-- simply hides the chip for them. New rows always have both columns.

alter table public.daily_devotions
  add column if not exists theme text,
  add column if not exists theme_label text;

comment on column public.daily_devotions.theme is
  'Curated theme id from the generator palette (e.g. hope), or the admin override for that day.';

comment on column public.daily_devotions.theme_label is
  'Display label for the theme, stored so readers never need the palette.';

-- Sorting/filtering an archive by theme is a plain index scan.
create index if not exists daily_devotions_theme
  on public.daily_devotions (theme);