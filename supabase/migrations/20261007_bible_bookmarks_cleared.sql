-- A removed Bible bookmark is a row, not a missing row.
--
-- Removing the bookmark writes book/chapter/translation = null and the touch
-- trigger stamps updated_at, so the row records WHEN it was cleared. Clients
-- compare that time with their local copy (newest wins), which lets another
-- device holding a stale local bookmark adopt the removal instead of
-- re-uploading it. A set row and a cleared row are the only valid shapes:
-- book and chapter are both present or both null. The existing
-- `chapter between 1 and 150` check passes for null. RLS (auth.uid() =
-- user_id) and the updated_at trigger from 20261006_bible_bookmarks.sql are
-- unchanged.
--
-- Rollback:
--   delete from public.bible_bookmarks where book is null;
--   alter table public.bible_bookmarks drop constraint bible_bookmarks_set_or_cleared;
--   alter table public.bible_bookmarks
--     alter column book set not null,
--     alter column chapter set not null,
--     alter column translation set not null;

alter table public.bible_bookmarks
  alter column book drop not null,
  alter column chapter drop not null,
  alter column translation drop not null;

alter table public.bible_bookmarks
  drop constraint if exists bible_bookmarks_set_or_cleared;

alter table public.bible_bookmarks
  add constraint bible_bookmarks_set_or_cleared check ((book is null) = (chapter is null));
