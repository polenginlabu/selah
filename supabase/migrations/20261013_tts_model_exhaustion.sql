-- Gemini TTS models whose quota is used up (the bible-tts Edge Function).
--
-- On the free tier each TTS model has its own small per-minute and per-day
-- quota. When one returns 429 / RESOURCE_EXHAUSTED the function records it
-- here until its quota resets (next Pacific midnight for a daily quota, about a
-- minute otherwise) and later requests skip it without spending a call.
-- Shared across all users: the quota belongs to the project's API key.
--
-- Service role only. RLS on with no policies and no grants to anon or
-- authenticated, so no client can read or change it. The function treats a
-- missing table or failed read as "nothing exhausted".
--
-- Rollback:
--   drop function if exists public.tts_model_exhausted(text, timestamptz);
--   drop table if exists public.tts_model_exhaustion;

create table if not exists public.tts_model_exhaustion (
  model text primary key,
  exhausted_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.tts_model_exhaustion enable row level security;

revoke all on table public.tts_model_exhaustion from public, anon, authenticated;
grant select on table public.tts_model_exhaustion to service_role;

/**
 * Marks a model exhausted until p_until. greatest() keeps the later time, so a
 * concurrent per-minute 429 can never shorten a daily window.
 */
create or replace function public.tts_model_exhausted(
  p_model text,
  p_until timestamptz
)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.tts_model_exhaustion (model, exhausted_until, updated_at)
  values (p_model, p_until, now())
  on conflict (model) do update
    set
      exhausted_until = greatest(public.tts_model_exhaustion.exhausted_until, excluded.exhausted_until),
      updated_at = now();
$$;

-- Only the service role (the Edge Function) may call this.
revoke all on function public.tts_model_exhausted(text, timestamptz) from public, anon, authenticated;
grant execute on function public.tts_model_exhausted(text, timestamptz) to service_role;
