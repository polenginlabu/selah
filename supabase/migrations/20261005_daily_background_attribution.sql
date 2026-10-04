-- Attribution for daily backgrounds that are stock photographs.
--
-- scripts/fetch-daily-background.js picks a freely-licensed photo (Pixabay
-- Content License, CC0, Public Domain Mark) for each day and records where it came
-- from: provider, source id and page, photographer, licence. The verse card
-- shows the credit, and the source id keeps the same photo from being reused
-- within 30 days.
--
-- Nullable: generated and hand-uploaded backgrounds have no attribution.

alter table public.daily_backgrounds
  add column if not exists attribution jsonb;

comment on column public.daily_backgrounds.attribution is
  'Stock photo credit: {provider, sourceId, sourceUrl, imageUrl, creator, creatorUrl, license, licenseUrl, query, fetchedAt}. Null for generated or uploaded art.';

-- Only stock photos (model 'stock:<provider>') carry a credit. The generate
-- and upload scripts upsert without an attribution key, so on a --force
-- replacement the update would otherwise keep the previous photographer's
-- credit on the new image. This clears it for every non-stock write.
create or replace function public.daily_backgrounds_clear_attribution()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.model is null or new.model not like 'stock:%' then
    new.attribution := null;
  end if;
  return new;
end;
$$;

drop trigger if exists daily_backgrounds_clear_attribution on public.daily_backgrounds;
create trigger daily_backgrounds_clear_attribution
  before insert or update on public.daily_backgrounds
  for each row execute function public.daily_backgrounds_clear_attribution();

-- An admin replacing a day's background must not leave the previous
-- photographer credited for the new image, so the upsert now clears it.
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
    (date, storage_path, image_url, theme, prompt, model, width, height, bytes, attribution)
  values (
    p_date,
    trim(p_storage_path),
    trim(p_image_url),
    trim(p_theme),
    null,                              -- no model prompt; the art was human-picked
    coalesce(p_model, 'admin-upload'),
    p_width,
    p_height,
    p_bytes,
    null                               -- an admin upload carries no stock credit
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
        attribution  = null,           -- and its credit
        created_at   = excluded.created_at;
end;
$$;

revoke all on function public.admin_upsert_daily_background(date, text, text, text, integer, integer, integer, text) from public;
grant execute on function public.admin_upsert_daily_background(date, text, text, text, integer, integer, integer, text) to authenticated;
