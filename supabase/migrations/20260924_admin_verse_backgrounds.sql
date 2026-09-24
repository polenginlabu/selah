-- Admin verse-background uploads: let an admin (from the app, no CLI) put a
-- hand-picked image behind a day's verse card.
--
-- The nightly pipeline stays exactly as it is: scripts/generate-daily-background.js
-- generates art, uploads the bytes to FIREBASE Storage with a service account,
-- and writes the daily_backgrounds row with the service role. This migration adds
-- a second, human-driven feed on top of the same table:
--
--   - the bytes go to Supabase Storage (bucket `verse-backgrounds`) rather than
--     Firebase. Deliberate: a manual upload is one small WebP per swap, against
--     a nightly stream of generated art, and the write authority can then live
--     in storage policies gated on is_admin() — the same database function that
--     gates every other admin action — instead of a service-account key in a
--     second system.
--   - the row is written by SECURITY DEFINER functions (admin_upsert_/delete),
--     mirroring admin_save_devotion_settings, so RLS on daily_backgrounds is
--     untouched: no client policy exists, clients write only through these.
--
-- The card cannot tell the feeds apart: it only reads image_url.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

-- Public on purpose — the verse card hands image_url straight to an <img>,
-- exactly as it does with Firebase URLs. Reads need no policy; writes are
-- locked down below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verse-backgrounds',
  'verse-backgrounds',
  true,
  20971520,                          -- 20 MB guard; the app pre-resizes to ~300 KB
  array['image/webp']                -- the browser only ever uploads WebP
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Storage write policies — admins only
-- ---------------------------------------------------------------------------

-- Insert AND update: the client uploads with `upsert: true` so re-uploading a
-- date replaces its object, so both paths must be gated. Delete too: the panel
-- removes a bad background by row first, then object.
drop policy if exists "Admins upload verse backgrounds" on storage.objects;
create policy "Admins upload verse backgrounds"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'verse-backgrounds' and public.is_admin());

drop policy if exists "Admins replace verse backgrounds" on storage.objects;
create policy "Admins replace verse backgrounds"
  on storage.objects
  for update
  to authenticated
  with check (bucket_id = 'verse-backgrounds' and public.is_admin());

drop policy if exists "Admins delete verse backgrounds" on storage.objects;
create policy "Admins delete verse backgrounds"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'verse-backgrounds' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Row writes — SECURITY DEFINER, admin-checked, like admin_save_devotion_settings
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_daily_background(
  p_date date,
  p_theme text,
  p_storage_path text,
  p_image_url text,
  p_width integer default null,
  p_height integer default null,
  p_bytes integer default null,
  p_model text default 'admin-upload'
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_require();

  if nullif(trim(coalesce(p_theme, '')), '') is null then
    raise exception 'A theme is required for a background row.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_storage_path, '')), '') is null then
    raise exception 'A storage path is required for a background row.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_image_url, '')), '') is null then
    raise exception 'An image URL is required for a background row.' using errcode = '22023';
  end if;

  -- The row must point at the object that was just uploaded. A row whose URL
  -- names a different object would orphan the real one and break the panel's
  -- delete flow, which removes storage_path.
  if position(trim(p_storage_path) in trim(p_image_url)) = 0 then
    raise exception 'Image URL does not match the storage path.' using errcode = '22023';
  end if;

  insert into public.daily_backgrounds as b
    (date, storage_path, image_url, theme, prompt, model, width, height, bytes)
  values (
    p_date,
    trim(p_storage_path),
    trim(p_image_url),
    trim(p_theme),
    null,                              -- no model prompt; the art was human-picked
    coalesce(p_model, 'admin-upload'),
    p_width,
    p_height,
    p_bytes
  )
  on conflict (date) do update
    set storage_path = excluded.storage_path,
        image_url    = excluded.image_url,
        theme        = excluded.theme,
        prompt       = null,           -- a replacement supersedes the old art
        model        = excluded.model,
        width        = excluded.width,
        height       = excluded.height,
        bytes        = excluded.bytes,
        created_at   = excluded.created_at;
end;
$$;

create or replace function public.admin_delete_daily_background(p_date date)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_require();
  delete from public.daily_backgrounds where date = p_date;
end;
$$;

revoke all on function public.admin_upsert_daily_background(date, text, text, text, integer, integer, integer, text) from public;
revoke all on function public.admin_delete_daily_background(date) from public;

grant execute on function public.admin_upsert_daily_background(date, text, text, text, integer, integer, integer, text) to authenticated;
grant execute on function public.admin_delete_daily_background(date) to authenticated;