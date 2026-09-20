-- One row per user: where they last read in the Bible.
--
-- The Bible reader already keeps the position in localStorage so it restores
-- instantly on the same device. This table adds the account copy so a signed-in
-- reader picks up where they left off on ANY device. The client writes on every
-- navigation and hydrates it once when the reader opens; localStorage stays the
-- instant/offline fallback, this row is the cross-device truth.
--
-- Same shape as meditation_settings (a single row per user, owned via RLS), so
-- it follows that migration's conventions: uid primary key, cascade delete,
-- auth.uid() policies, and an updated_at touch trigger.

create table if not exists public.reading_positions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  book text not null,
  chapter smallint not null check (chapter between 1 and 150),
  translation text not null default 'nivuk',
  updated_at timestamptz not null default now()
);

alter table public.reading_positions enable row level security;

create policy "Users manage their own reading position"
  on public.reading_positions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_reading_positions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reading_positions_touch_updated_at on public.reading_positions;
create trigger reading_positions_touch_updated_at
  before update on public.reading_positions
  for each row execute function public.touch_reading_positions_updated_at();