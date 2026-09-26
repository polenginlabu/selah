-- Prayer simplify — Path B (adapt the live three-table schema).
--
-- The original 20260926_prayer.sql (prayer_categories + recurrence + status)
-- was already applied to this database, so the rewritten 20260926 file cannot
-- be applied here: its `create policy "Users manage their own prayer items"`
-- collides with the existing policy of the same name. This migration ADAPTS
-- the live schema to the flat daily-checklist model instead of re-creating
-- tables, and it preserves every existing row (categories stay as an inert,
-- RLS-protected archive; old items keep their category linkage; activity
-- keeps its status/note columns, which the flat app simply ignores).
--
-- Idempotent: safe to run again if a previous attempt left partial artifacts
-- (every statement is drop-if-exists / if-not-exists / create-or-replace).

-- 1. Swap the item/activity policies to the flat model.
--    (The prayer_categories policy is left alone — the table remains
--    RLS-protected by auth.uid() for anyone reading archived data.)
drop policy if exists "Users manage their own prayer items" on public.prayer_items;
drop policy if exists "Users manage their own prayer activity" on public.prayer_activity;

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

-- 2. The flat app inserts items WITHOUT a category. Drop NOT NULL on
--    category_id so new rows are category-less; keep the column and its
--    foreign key so existing rows keep their (now-inert) category linkage.
alter table public.prayer_items
  alter column category_id drop not null;

-- 3. Flat list-wide ordering index (the old per-category index is kept; both
--    are used by their respective queries and are harmless together).
--    prayer_activity_user_date_idx already exists from the old schema.
create index if not exists prayer_items_user_order_idx
  on public.prayer_items (user_id, sort_order, created_at);
create index if not exists prayer_activity_user_date_idx
  on public.prayer_activity (user_id, prayer_date desc);

-- 4. Touch trigger on prayer_items (house pattern; matches the flat model).
--    Old rows are untouched by this — the trigger only stamps future updates.
drop trigger if exists prayer_items_touch_updated_at on public.prayer_items;
create trigger prayer_items_touch_updated_at
  before update on public.prayer_items
  for each row execute function public.touch_prayer_items_updated_at();