-- One push per physical device: iOS Safari reissues FCM tokens on OS/app
-- updates and site-data clears, and without a device identity the old token
-- lived on in device_tokens as a second row for the same device — the
-- meditation-reminder loop sent one push per row, so reminders produced
-- "double alerts" on iPad/iPhone.
--
-- device_id is generated client-side per install context (localStorage) and
-- sent with each registration (see src/lib/firebase.js enableNotifications()).
-- The client deletes that context's previous token before upserting, and this
-- index makes the invariant explicit at the DB level too: at most one live
-- token per (user, install).
--
-- Existing rows predate device_id and keep delivering until each device
-- re-enables notifications once (the client then retires that install's old
-- row). The token-unique constraint from 20260915_dedupe_device_tokens stays.

alter table public.device_tokens add column if not exists device_id text;

create unique index if not exists device_tokens_user_device_key
  on public.device_tokens (user_id, device_id)
  where device_id is not null;