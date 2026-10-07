-- Devotion time reminders with "not too late" follow-ups.
--
-- devotion_reminder_settings: one row per user — whether reminders are on, the
-- local time to remind, and how many follow-ups (0..2) to send at +2h / +5h.
-- The timezone comes from notification_profiles, which the app refreshes.
--
-- devotion_completions: the daily devotion's "Mark as complete", synced from
-- the reader so the scheduler can tell the day is done. A personal journal
-- entry in public.devotions for the same local date also counts as done.
--
-- devotion_reminder_log: one row per (user, local date, kind) sent. The
-- devotion-reminder function inserts the row BEFORE sending, so the primary
-- key is what stops overlapping runs from double-sending. Service role only.
--
-- Rollback: drop the three tables and the touch function. Nothing else
-- references them.

create table if not exists public.devotion_reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  remind_time time not null default '06:30',
  followups smallint not null default 2 check (followups between 0 and 2),
  updated_at timestamptz not null default now()
);

alter table public.devotion_reminder_settings enable row level security;

drop policy if exists "Users manage their own devotion reminder settings" on public.devotion_reminder_settings;
create policy "Users manage their own devotion reminder settings"
  on public.devotion_reminder_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_devotion_reminder_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists devotion_reminder_settings_touch_updated_at on public.devotion_reminder_settings;
create trigger devotion_reminder_settings_touch_updated_at
  before update on public.devotion_reminder_settings
  for each row execute function public.touch_devotion_reminder_settings_updated_at();

create table if not exists public.devotion_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

alter table public.devotion_completions enable row level security;

drop policy if exists "Users manage their own devotion completions" on public.devotion_completions;
create policy "Users manage their own devotion completions"
  on public.devotion_completions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.devotion_reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  kind text not null check (kind in ('initial', 'followup1', 'followup2')),
  sent_at timestamptz not null default now(),
  primary key (user_id, local_date, kind)
);

-- RLS on with no policies: clients can neither read nor write the log. Only
-- the service role (which bypasses RLS) used by the edge function touches it.
alter table public.devotion_reminder_log enable row level security;
