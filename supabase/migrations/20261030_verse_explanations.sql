-- Bible reader "Explain" answers, cached per reference + translation.
--
-- Written by public/bridge.php with the service-role key when an Explain job
-- on the OpenCode bridge finishes; read by bridge.php with the reader's own
-- JWT before starting a new job. Every reader of "John 3:16" in the same
-- translation shares one row.
--
-- Signed-in users may SELECT. There are deliberately NO insert, update or
-- delete policies: a reader who could write here could replace an explanation
-- for everyone. Only the service role writes.
--
-- To regenerate one explanation, delete its row; the next reader's Explain
-- produces a fresh one.
--
-- Rollback:
--   drop table if exists public.verse_explanations;

create table if not exists public.verse_explanations (
  id bigint generated always as identity primary key,
  reference text not null check (char_length(reference) between 1 and 120),
  translation text not null check (char_length(translation) between 1 and 60),
  content text not null check (char_length(content) between 1 and 40000),
  model text not null default '',
  created_at timestamptz not null default now(),
  unique (reference, translation)
);

alter table public.verse_explanations enable row level security;

drop policy if exists "verse_explanations readable by signed-in users" on public.verse_explanations;
create policy "verse_explanations readable by signed-in users"
  on public.verse_explanations
  for select
  to authenticated
  using (true);
