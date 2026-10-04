-- One row per user: the chapter bookmark in the Bible reader.
--
-- Unlike reading_positions (updated on every navigation), this row only
-- changes when the reader explicitly sets or removes the bookmark; removing it
-- deletes the row. localStorage (bible:bookmark) stays the instant/offline
-- copy, this row is the cross-device truth.
--
-- Same shape and conventions as reading_positions: uid primary key, cascade
-- delete, auth.uid() policy, and an updated_at touch trigger.
-- Rollback: drop table public.bible_bookmarks;

create table if not exists public.bible_bookmarks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  book text not null,
  chapter smallint not null check (chapter between 1 and 150),
  translation text not null default 'nivuk',
  updated_at timestamptz not null default now()
);

alter table public.bible_bookmarks enable row level security;

create policy "Users manage their own Bible bookmark"
  on public.bible_bookmarks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_bible_bookmarks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bible_bookmarks_touch_updated_at on public.bible_bookmarks;
create trigger bible_bookmarks_touch_updated_at
  before update on public.bible_bookmarks
  for each row execute function public.touch_bible_bookmarks_updated_at();
