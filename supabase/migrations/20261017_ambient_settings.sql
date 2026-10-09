-- Admin-chosen ambient animation behind the devotional card and reader.
--
-- One row:
--   - mode        auto (by season) | fixed (always `effect`) | off
--   - effect      gold | snow | snowflakes | leaves | petals | fireflies
--   - intensity   subtle | normal
--   - hemisphere  north | south   which months are which season in auto mode
-- The default row is fixed gold dust, the look before this table existed. The
-- month-to-effect mapping and the cleaning rules live in
-- src/lib/ambientEffects.js; the checks here are a backstop.
--
-- Admins read and write the table; readers (any signed-in user) get the four
-- public fields through get_ambient_settings(). A missing row or a failed read
-- makes the app show gold dust.
--
-- Rollback:
--   drop function if exists public.get_ambient_settings();
--   drop table if exists public.ambient_settings;
--   drop function if exists public.touch_ambient_settings();

create table if not exists public.ambient_settings (
  id boolean primary key default true,
  mode text not null default 'fixed',
  effect text not null default 'gold',
  intensity text not null default 'normal',
  hemisphere text not null default 'north',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (id),  -- the primary key only ever equals true, so this stays one row
  constraint ambient_settings_mode check (mode in ('auto', 'fixed', 'off')),
  constraint ambient_settings_effect check (
    effect in ('gold', 'snow', 'snowflakes', 'leaves', 'petals', 'fireflies')
  ),
  constraint ambient_settings_intensity check (intensity in ('subtle', 'normal')),
  constraint ambient_settings_hemisphere check (hemisphere in ('north', 'south'))
);

insert into public.ambient_settings (id) values (true)
on conflict (id) do nothing;

create or replace function public.touch_ambient_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists ambient_settings_touch on public.ambient_settings;
create trigger ambient_settings_touch
  before insert or update on public.ambient_settings
  for each row execute function public.touch_ambient_settings();

alter table public.ambient_settings enable row level security;

-- No delete policy: the layer is switched off, not removed.
drop policy if exists "Admins read ambient settings" on public.ambient_settings;
create policy "Admins read ambient settings"
  on public.ambient_settings for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins insert ambient settings" on public.ambient_settings;
create policy "Admins insert ambient settings"
  on public.ambient_settings for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins update ambient settings" on public.ambient_settings;
create policy "Admins update ambient settings"
  on public.ambient_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.ambient_settings from anon;
revoke all on public.ambient_settings from authenticated;
grant select, insert, update on public.ambient_settings to authenticated;

create or replace function public.get_ambient_settings()
returns table (mode text, effect text, intensity text, hemisphere text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(s.mode, 'fixed'),
    coalesce(s.effect, 'gold'),
    coalesce(s.intensity, 'normal'),
    coalesce(s.hemisphere, 'north')
  from (select true as one) as x
  left join public.ambient_settings s on s.id = true;
$$;

revoke all on function public.get_ambient_settings() from public;
revoke all on function public.get_ambient_settings() from anon;
grant execute on function public.get_ambient_settings() to authenticated;
