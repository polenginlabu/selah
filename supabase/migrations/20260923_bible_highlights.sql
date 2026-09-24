-- Persistent Bible verse highlights.
--
-- The reader keeps verse highlights in localStorage so they restore instantly
-- on the same device (and work fully signed-out). This table is the account
-- copy so a signed-in reader sees their highlights on ANY device. Storage is
-- one row per user/book/chapter holding a jsonb map { verseNumber: color }.
-- Cross-device writes are last-write-wins per chapter (the same tradeoff as
-- reading_positions); the reader re-reads its row whenever a chapter opens and
-- writes the merged local ∪ server map, which keeps the overwrite window to
-- the time the chapter is open. The map is validated on write — see the
-- validate_bible_highlights_verses trigger below.
--
-- Same conventions as 20260920_reading_positions.sql: composite uid PK rows,
-- cascade delete, auth.uid() policies, and an updated_at touch trigger.

create table if not exists public.bible_highlights (
  user_id uuid not null references auth.users(id) on delete cascade,
  book text not null,
  chapter smallint not null check (chapter between 1 and 150),
  verses jsonb not null default '{}'::jsonb check (jsonb_typeof(verses) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, book, chapter)
);

alter table public.bible_highlights enable row level security;

create policy "Users manage their own verse highlights"
  on public.bible_highlights
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_bible_highlights_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bible_highlights_touch_updated_at on public.bible_highlights;
create trigger bible_highlights_touch_updated_at
  before update on public.bible_highlights
  for each row execute function public.touch_bible_highlights_updated_at();

-- The verses map is validated on write (not just types): keys must be verse
-- numbers, values must be palette ids, and the map is capped well above the
-- longest canonical chapter (Psalm 119 has 176 verses) so a buggy or hostile
-- client cannot stuff its own row with junk that every device then re-reads.
create or replace function public.validate_bible_highlights_verses()
returns trigger
language plpgsql
as $$
declare
  entry record;
  n int := 0;
begin
  if jsonb_typeof(new.verses) <> 'object' then
    raise exception 'bible_highlights.verses must be a JSON object';
  end if;
  for entry in select key, value from jsonb_each_text(new.verses) loop
    n := n + 1;
    if n > 300 then
      raise exception 'bible_highlights.verses has more than 300 entries';
    end if;
    if entry.key !~ '^(0|[1-9][0-9]*)$' then
      raise exception 'bible_highlights.verses key is not a verse number: %', entry.key;
    end if;
    if entry.value not in ('yellow', 'pink', 'green', 'blue') then
      raise exception 'bible_highlights.verses has an invalid highlight color: %', entry.value;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists bible_highlights_validate_verses on public.bible_highlights;
create trigger bible_highlights_validate_verses
  before insert or update on public.bible_highlights
  for each row execute function public.validate_bible_highlights_verses();