-- Per-user rate limiting for the Scripture study assistant.
--
-- Edge Functions are stateless between invocations, so an in-process counter
-- would reset constantly and cap nothing. The counter has to live in Postgres.
--
-- Keyed on the authenticated user rather than an IP: a user id cannot be
-- spoofed, and an IP would punish an entire church sharing one wifi as though
-- it were a single abuser.

create table if not exists public.chat_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
);

alter table public.chat_rate_limits enable row level security;

-- No policies: this is written only by the SECURITY DEFINER function below,
-- called by the Edge Function. A client that could edit its own counter would
-- have no rate limit at all.

/**
 * Records one request and reports whether it is allowed.
 *
 * The whole check-and-increment is a single statement so two concurrent
 * requests cannot both read "9 used" and both proceed. ON CONFLICT makes the
 * upsert atomic; the CASE resets the window when the last one has expired.
 */
create or replace function public.chat_rate_limit_hit(
  p_user_id uuid,
  p_max_per_minute integer
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

  insert into public.chat_rate_limits (user_id, window_started_at, request_count)
  values (p_user_id, now(), 1)
  on conflict (user_id) do update
    set
      window_started_at = case
        when public.chat_rate_limits.window_started_at < now() - interval '1 minute'
          then now()
        else public.chat_rate_limits.window_started_at
      end,
      request_count = case
        when public.chat_rate_limits.window_started_at < now() - interval '1 minute'
          then 1
        else public.chat_rate_limits.request_count + 1
      end
  returning request_count into new_count;

  return new_count <= greatest(p_max_per_minute, 1);
end;
$$;

-- Only the service role (the Edge Function) may call this. Granting it to
-- authenticated would let a client burn its own budget to no purpose, or probe
-- other users' ids.
revoke all on function public.chat_rate_limit_hit(uuid, integer) from public;
grant execute on function public.chat_rate_limit_hit(uuid, integer) to service_role;
