-- Lets an admin see the disciples belonging to each user.
--
-- Depends on 20260910_admin_console.sql (admin_emails, admin_require). Apply
-- that one first.
--
-- Same rule as everything in the admin surface: RLS on public.disciples scopes
-- reads to the caller's own tree, so this has to be SECURITY DEFINER to look
-- across trees — and therefore has to re-check admin_require() itself.

-- ---------------------------------------------------------------------------
-- Add a disciple count to the user list
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE cannot change a function's return type, and this adds a
-- column, so the old one has to go first.
drop function if exists public.admin_list_users();

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  avatar_url text,
  xp integer,
  level integer,
  disciple_count integer,
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
      coalesce(p.full_name, u.raw_user_meta_data ->> 'full_name')::text,
      coalesce(p.avatar_url, u.raw_user_meta_data ->> 'avatar_url')::text,
      coalesce(s.xp, 0)::integer,
      ((coalesce(s.xp, 0) / 100) + 1)::integer,
      -- Every tree has a generation-0 root standing for the owner themselves.
      -- Counting it would report "1 disciple" for someone who has none, so
      -- exclude it — this mirrors disciples_one_root_per_owner.
      (
        select count(*)
        from public.disciples d
        where d.tree_owner_id = u.id
          and not (d.parent_id is null and d.generation = 0)
      )::integer,
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
-- One user's disciples
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_disciples(target_id uuid)
returns table (
  id uuid,
  name text,
  email text,
  mobile_number text,
  generation integer,
  parent_id uuid,
  parent_name text,
  linked_user_id uuid,
  lifetime_phase integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_require();

  return query
    select
      d.id,
      d.name::text,
      d.email::text,
      d.mobile_number::text,
      d.generation::integer,
      d.parent_id,
      parent.name::text,
      d.linked_user_id,
      coalesce(d.lifetime_phase, 0)::integer,
      d.created_at
    from public.disciples d
    left join public.disciples parent on parent.id = d.parent_id
    where d.tree_owner_id = target_id
      -- The root row is the owner, not one of their disciples.
      and not (d.parent_id is null and d.generation = 0)
    order by d.generation asc, d.created_at asc;
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_list_disciples(uuid) from public;

grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_list_disciples(uuid) to authenticated;
