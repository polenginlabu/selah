-- Users were getting duplicate meditation/conquest pushes because the app
-- upserted device_tokens without a unique constraint on token, so every
-- registration (page load, re-login, extra tab) inserted another row for the
-- same physical device. The reminder loop then sent one push per row.
--
-- 1. Remove any existing duplicate rows (keep the earliest per token).
-- 2. Enforce uniqueness on token so enableNotifications() upsert dedupes.

delete from public.device_tokens a
using public.device_tokens b
where a.token = b.token
  and a.ctid < b.ctid;

alter table public.device_tokens
  drop constraint if exists device_tokens_token_key;

alter table public.device_tokens
  add constraint device_tokens_token_key unique (token);