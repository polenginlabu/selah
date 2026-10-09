-- Admin-editable settings for the daily background search.
--
-- The nightly job (scripts/fetch-daily-background.js) reads ONE row here with
-- the service role and applies it on top of its built-in search:
--   - phrases      the admin's search phrases, tried first (mode 'first') or
--                  instead of the built-in ones (mode 'only')
--   - style_term   added to each phrase ("minimalist"); blank = none
--   - deny_words   added to the built-in deny list, never replacing it
--   - image_type   illustration | photo | all
--   - use_pixabay / use_openverse   which providers to ask
-- enabled = false, a missing row or a bad value means "behave as without it".
-- The cleaning rules (lengths, characters) live in
-- supabase/functions/_shared/backgroundSearch.js; the checks here are a backstop.
--
-- Also adds the per-admin rate limit for the background-preview Edge Function,
-- the same pattern as 20261011_tts_rate_limit.sql in its own table.
--
-- Rollback:
--   drop function if exists public.background_preview_rate_limit_hit(uuid, integer);
--   drop table if exists public.background_preview_rate_limits;
--   drop table if exists public.background_search_settings;
--   drop function if exists public.touch_background_search_settings();

create table if not exists public.background_search_settings (
  id boolean primary key default true,
  enabled boolean not null default true,
  phrases jsonb not null default '[]'::jsonb,
  mode text not null default 'first',
  style_term text not null default 'minimalist',
  deny_words jsonb not null default '[]'::jsonb,
  image_type text not null default 'illustration',
  use_pixabay boolean not null default true,
  use_openverse boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (id),  -- the primary key only ever equals true, so this stays one row
  constraint background_search_settings_mode check (mode in ('first', 'only')),
  constraint background_search_settings_image_type check (image_type in ('illustration', 'photo', 'all')),
  constraint background_search_settings_phrases check (
    jsonb_typeof(phrases) = 'array' and jsonb_array_length(phrases) <= 20
  ),
  constraint background_search_settings_deny_words check (
    jsonb_typeof(deny_words) = 'array' and jsonb_array_length(deny_words) <= 50
  ),
  constraint background_search_settings_style_term check (char_length(style_term) <= 30)
);

insert into public.background_search_settings (id) values (true)
on conflict (id) do nothing;

create or replace function public.touch_background_search_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists background_search_settings_touch on public.background_search_settings;
create trigger background_search_settings_touch
  before insert or update on public.background_search_settings
  for each row execute function public.touch_background_search_settings();

alter table public.background_search_settings enable row level security;

-- Admins read and write it from the app; the service role (the nightly job)
-- bypasses RLS. No delete policy: the row is switched off, not removed.
drop policy if exists "Admins read background search settings" on public.background_search_settings;
create policy "Admins read background search settings"
  on public.background_search_settings for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins insert background search settings" on public.background_search_settings;
create policy "Admins insert background search settings"
  on public.background_search_settings for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins update background search settings" on public.background_search_settings;
create policy "Admins update background search settings"
  on public.background_search_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.background_search_settings from anon;
revoke all on public.background_search_settings from authenticated;
grant select, insert, update on public.background_search_settings to authenticated;

-- ---------------------------------------------------------------------------
-- background-preview rate limit
-- ---------------------------------------------------------------------------

create table if not exists public.background_preview_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
);

alter table public.background_preview_rate_limits enable row level security;

-- No policies: written only by the SECURITY DEFINER function below, called by
-- the Edge Function with the service role.

/** Records one preview and reports whether it is allowed (10-minute window). */
create or replace function public.background_preview_rate_limit_hit(
  p_user_id uuid,
  p_max_per_window integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  new_count integer;
begin
  if p_user_id is null then
    return false;
  end if;

  insert into public.background_preview_rate_limits (user_id, window_started_at, request_count)
  values (p_user_id, now(), 1)
  on conflict (user_id) do update
    set
      window_started_at = case
        when public.background_preview_rate_limits.window_started_at < now() - interval '10 minutes'
          then now()
        else public.background_preview_rate_limits.window_started_at
      end,
      request_count = case
        when public.background_preview_rate_limits.window_started_at < now() - interval '10 minutes'
          then 1
        else public.background_preview_rate_limits.request_count + 1
      end
  returning request_count into new_count;

  return new_count <= greatest(p_max_per_window, 1);
end;
$$;

revoke all on function public.background_preview_rate_limit_hit(uuid, integer) from public;
grant execute on function public.background_preview_rate_limit_hit(uuid, integer) to service_role;
