-- "Use default photo" for the daily background.
--
-- Two columns on the admin-only background_search_settings row:
--   - use_default_photo      show one chosen photo every day instead of the day's
--   - default_background_id  that photo: an existing daily_backgrounds row, so its
--                            image_url and attribution stay the original ones.
--                            Deleting the row nulls this, which means "normal".
-- The table's admin-only RLS and table-level grants cover the new columns.
--
-- Readers (any signed-in user) cannot see that table, so get_default_background()
-- returns only what they need: {enabled, background_id, image_url, attribution}.
-- enabled is true only when the toggle is on AND the photo row still exists.
-- The nightly job (service role) reads the row directly and skips the stock
-- search while the default is on.
--
-- Rollback:
--   drop function if exists public.get_default_background();
--   alter table public.background_search_settings
--     drop column if exists default_background_id,
--     drop column if exists use_default_photo;

alter table public.background_search_settings
  add column if not exists use_default_photo boolean not null default false,
  add column if not exists default_background_id uuid
    references public.daily_backgrounds(id) on delete set null;

create or replace function public.get_default_background()
returns table (enabled boolean, background_id uuid, image_url text, attribution jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(s.use_default_photo and b.id is not null, false),
    b.id,
    b.image_url,
    b.attribution
  from (select true as one) as x
  left join public.background_search_settings s on s.id = true
  left join public.daily_backgrounds b
    on b.id = s.default_background_id and s.use_default_photo;
$$;

revoke all on function public.get_default_background() from public;
revoke all on function public.get_default_background() from anon;
grant execute on function public.get_default_background() to authenticated;
