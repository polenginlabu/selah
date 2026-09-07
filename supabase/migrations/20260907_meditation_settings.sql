-- One row per user: their daily meditation focus word and reminder preferences.
-- focus_word_date lets the client tell "today's word" from a stale one without
-- a separate cleanup job — a mismatched date just reads as no word set yet.
create table if not exists public.meditation_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  frequency_hours smallint not null default 4 check (frequency_hours in (1, 4)),
  focus_word text,
  focus_word_date date,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.meditation_settings enable row level security;

create policy "Users manage their own meditation settings"
  on public.meditation_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_meditation_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists meditation_settings_touch_updated_at on public.meditation_settings;
create trigger meditation_settings_touch_updated_at
  before update on public.meditation_settings
  for each row execute function public.touch_meditation_settings_updated_at();
