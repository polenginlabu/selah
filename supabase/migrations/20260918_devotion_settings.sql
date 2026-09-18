-- Admin-configurable daily devotion generator settings.
--
-- The nightly generator (scripts/generate-daily-devotion.js) reads ONE row here
-- at run time and injects it into the SELAH brief:
--   - teachers     which trusted teachers the agent researches (name + url);
--                  empty means "fall back to the brief's default sources"
--   - theme        a topic/theme to build the devotional around; empty means
--                  the agent keeps its normal intentional-randomness
--   - translation  the Scripture translation to quote (we ship NIV)
--
-- A single locked row (id = true) rather than a table of many: there is only
-- one devotional generator, so there is only one configuration. Teachers are a
-- jsonb array because they carry no identity or relations of their own — the
-- same shape the rest of the devotion data uses (questions, sources).

create table if not exists public.devotion_settings (
  id boolean primary key default true,
  theme text,
  translation text not null default 'NIV',
  teachers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  check (id)  -- the primary key only ever equals true, so this stays one row
);

comment on column public.devotion_settings.teachers is
  'Array of {name, url} for the teachers the agent should research. Empty = use the brief default sources.';

insert into public.devotion_settings (id, theme, translation, teachers)
values (true, null, 'NIV', '[]'::jsonb)
on conflict (id) do nothing;

alter table public.devotion_settings enable row level security;

-- No client policies. The row is read by the service role (the generator,
-- which bypasses RLS) and by admins through the SECURITY DEFINER functions
-- below. Everyone else is denied by default.

create or replace function public.touch_devotion_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists devotion_settings_touch_updated_at on public.devotion_settings;
create trigger devotion_settings_touch_updated_at
  before update on public.devotion_settings
  for each row execute function public.touch_devotion_settings_updated_at();

-- ---------------------------------------------------------------------------
-- Admin access
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_devotion_settings()
returns table (
  theme text,
  translation text,
  teachers jsonb,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_require();

  return query
    select s.theme, s.translation, s.teachers, s.updated_at
    from public.devotion_settings s
    where s.id = true;
end;
$$;

create or replace function public.admin_save_devotion_settings(
  p_theme text,
  p_translation text default 'NIV',
  p_teachers jsonb default '[]'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_require();

  -- Teachers must be an array of {name, url} objects; anything else is a
  -- caller bug and should not silently corrupt the stored config.
  if jsonb_typeof(coalesce(p_teachers, '[]'::jsonb)) <> 'array' then
    raise exception 'teachers must be a JSON array' using errcode = '22023';
  end if;

  insert into public.devotion_settings as s (id, theme, translation, teachers)
  values (true, nullif(trim(coalesce(p_theme, '')), ''), coalesce(p_translation, 'NIV'), coalesce(p_teachers, '[]'::jsonb))
  on conflict (id) do update
    set theme       = excluded.theme,
        translation = coalesce(excluded.translation, 'NIV'),
        teachers    = excluded.teachers;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.admin_get_devotion_settings() from public;
revoke all on function public.admin_save_devotion_settings(text, text, jsonb) from public;

grant execute on function public.admin_get_devotion_settings() to authenticated;
grant execute on function public.admin_save_devotion_settings(text, text, jsonb) to authenticated;