-- Admin console for Selah.
--
-- SECURITY NOTE — read before changing anything here.
--
-- The browser only ever holds the anon key, and any signed-in user can call
-- PostgREST directly with their own JWT. Hiding a nav item or checking an
-- email in React is therefore decoration, not access control: the real check
-- has to happen inside the database, on every call. That is what this file is.
--
-- These functions are SECURITY DEFINER because they must read auth.users and
-- reach across per-user RLS. That makes them the most privileged code in the
-- project, so each one re-checks admin_require() as its first statement and
-- each has a pinned search_path (an unpinned one lets a caller shadow the
-- tables the function resolves).
--
-- Apply as the postgres role (Supabase SQL editor does this): admin_delete_user
-- removes rows from auth.users, which only the owner of that table may do.

-- ---------------------------------------------------------------------------
-- Who is an admin
-- ---------------------------------------------------------------------------

-- A table rather than a hardcoded constant so admins can be added or revoked
-- without a code deploy — and so revoking takes effect immediately for
-- sessions already holding a valid JWT.
create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.admin_emails enable row level security;

-- Deliberately NO policies. RLS with zero policies denies every client read
-- and write, so no one can enumerate or edit the admin list over the API. The
-- SECURITY DEFINER functions below bypass RLS and are the only way in.

insert into public.admin_emails (email)
values ('johnpaul.dj21@gmail.com')
on conflict (email) do nothing;

-- Reads the *caller's* email from their JWT. SECURITY DEFINER raises the
-- privilege level but does not change whose token this is, so this stays an
-- honest check of the person making the request.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.admin_emails a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.admin_require()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    -- 42501 = insufficient_privilege; surfaces to PostgREST as HTTP 403.
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- List users
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  avatar_url text,
  xp integer,
  level integer,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_admin boolean
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform public.admin_require();

  return query
    select
      u.id,
      u.email::text,
      -- profiles is the display name of record, but a user who has never
      -- written a profile row still needs a name, so fall back to the OAuth
      -- metadata Google gave us at sign-up.
      coalesce(p.full_name, u.raw_user_meta_data ->> 'full_name')::text,
      coalesce(p.avatar_url, u.raw_user_meta_data ->> 'avatar_url')::text,
      coalesce(s.xp, 0)::integer,
      -- Mirrors getLevel() in src/lib/gamification.js (XP_PER_LEVEL = 100).
      -- Kept in SQL so sorting and display agree without a second round trip.
      ((coalesce(s.xp, 0) / 100) + 1)::integer,
      u.created_at,
      u.last_sign_in_at,
      exists (
        select 1 from public.admin_emails a
        where lower(a.email) = lower(u.email)
      )
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_stats s on s.user_id = u.id
    order by coalesce(s.xp, 0) desc, u.created_at asc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reset progress
-- ---------------------------------------------------------------------------

-- Zeroes the whole gamification state, not just the XP number. Clearing xp
-- alone would strand the user: one-time achievements stay flagged as claimed,
-- so the XP they granted could never be re-earned, and their level would never
-- recover to where it was.
create or replace function public.admin_reset_user_progress(target_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  perform public.admin_require();

  update public.user_stats
  set xp = 0,
      achievements = '{}'::jsonb,
      checkins = '{}'::jsonb,
      verses = 0,
      conquest_done = 0,
      evangelism = 0,
      spiritual = 0,
      community = 0,
      outreach = 0,
      leadership = 0,
      service = 0,
      updated_at = now()
  where user_id = target_id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.admin_reset_all_progress()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  perform public.admin_require();

  update public.user_stats
  set xp = 0,
      achievements = '{}'::jsonb,
      checkins = '{}'::jsonb,
      verses = 0,
      conquest_done = 0,
      evangelism = 0,
      spiritual = 0,
      community = 0,
      outreach = 0,
      leadership = 0,
      service = 0,
      updated_at = now()
  where xp <> 0
     or achievements <> '{}'::jsonb
     or checkins <> '{}'::jsonb;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ---------------------------------------------------------------------------
-- Delete a user
-- ---------------------------------------------------------------------------

create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  dependent record;
begin
  perform public.admin_require();

  if target_id is null then
    raise exception 'No user specified' using errcode = '22004';
  end if;

  -- Locking yourself out of the console is unrecoverable from inside the app.
  if target_id = auth.uid() then
    raise exception 'You cannot delete your own account' using errcode = '42501';
  end if;

  -- Same reasoning one step out: an admin deleting the last other admin, or
  -- each other in a race, leaves no way back in.
  if exists (
    select 1
    from auth.users u
    join public.admin_emails a on lower(a.email) = lower(u.email)
    where u.id = target_id
  ) then
    raise exception 'Cannot delete an admin account. Remove them from admin_emails first.'
      using errcode = '42501';
  end if;

  -- The tables here predate this migration and were created through the
  -- dashboard, so their FKs to auth.users are a mix of CASCADE and NO ACTION.
  -- Rather than hardcode a list that silently rots as tables are added, ask
  -- the catalog which public columns actually reference auth.users(id) and
  -- clear those. Anything deeper (attendance_records -> disciples) is reached
  -- by that table's own cascade.
  for dependent in
    select
      n.nspname as schema_name,
      c.relname as table_name,
      a.attname as column_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace rn on rn.oid = rc.relnamespace
    where con.contype = 'f'
      and rn.nspname = 'auth'
      and rc.relname = 'users'
      and n.nspname = 'public'
      and array_length(con.conkey, 1) = 1
  loop
    execute format(
      'delete from %I.%I where %I = $1',
      dependent.schema_name, dependent.table_name, dependent.column_name
    ) using target_id;
  end loop;

  delete from auth.users where id = target_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Revoke the default EXECUTE-to-everyone, then hand it back only to signed-in
-- users. anon cannot even attempt a call; authenticated non-admins get a 403
-- from admin_require() rather than reaching any data.
revoke all on function public.is_admin() from public;
revoke all on function public.admin_require() from public;
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_reset_user_progress(uuid) from public;
revoke all on function public.admin_reset_all_progress() from public;
revoke all on function public.admin_delete_user(uuid) from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_reset_user_progress(uuid) to authenticated;
grant execute on function public.admin_reset_all_progress() to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- admin_require is an internal helper; nothing outside these functions calls it.
