-- A read-only, de-identified view of discipleship health, plus a Postgres role
-- that can read nothing else.
--
-- WHY THIS EXISTS
--
-- The plan is to let an AI agent analyse discipleship — who needs following
-- up, where growth has stalled. The agent runs with a shell, so whatever
-- credential it holds it can use freely. The only server-side key we had was
-- the service_role key, which bypasses every RLS policy: an agent holding it
-- could delete the disciples table as easily as read it.
--
-- So it gets its own role instead, with SELECT on one view and no other grant
-- in the database. The worst a confused or prompt-injected agent can do with
-- it is read numbers it was meant to read.
--
-- WHAT THE AGENT CANNOT SEE
--
-- Names, emails, mobile numbers, birthdays and — most importantly — the notes
-- field, which holds pastoral detail people shared in confidence. The view
-- exposes short opaque refs instead. Suggestions come back keyed by ref and
-- are matched to real people inside the app, so nobody's name is ever sent to
-- a model provider.
--
-- Birthdays are reduced to a month: enough to time a follow-up, not enough to
-- identify anyone.

-- ── The view ────────────────────────────────────────────────────────────────
drop view if exists public.discipleship_signals;

create view public.discipleship_signals
with (security_invoker = false) as
with descendants as (
  -- Everyone beneath each disciple, at any depth. The tree is small (low
  -- hundreds), so the recursive walk costs nothing and saves the agent from
  -- trying to reconstruct the hierarchy itself.
  select
    d.id as ancestor_id,
    child.id as descendant_id
  from public.disciples d
  join lateral (
    with recursive walk as (
      select c.id, c.parent_id
      from public.disciples c
      where c.parent_id = d.id
      union all
      select c.id, c.parent_id
      from public.disciples c
      join walk w on c.parent_id = w.id
    )
    select walk.id from walk
  ) child on true
),
attendance as (
  select
    a.disciple_id,
    count(*)                                          as sessions_recorded,
    count(*) filter (where a.present)                 as sessions_present,
    max(a.session_date) filter (where a.present)      as last_present_on,
    max(a.session_date)                               as last_recorded_on
  from public.attendance_records a
  group by a.disciple_id
),
-- Absences since the last time they actually showed up. This is the signal
-- that matters pastorally: a 60% attendance rate built from a steady pattern
-- is a very different situation from 60% where every recent session is a miss.
recent_absences as (
  select
    a.disciple_id,
    count(*) as consecutive_absences
  from public.attendance_records a
  left join attendance t on t.disciple_id = a.disciple_id
  where not a.present
    and (t.last_present_on is null or a.session_date > t.last_present_on)
  group by a.disciple_id
)
select
  -- Short, stable, opaque. Enough for an agent to reference someone in its
  -- output; useless to anyone without database access.
  left(d.id::text, 8)                                        as ref,
  left(d.tree_owner_id::text, 8)                             as leader_ref,
  left(d.parent_id::text, 8)                                 as parent_ref,

  d.generation,
  d.lifetime_phase,
  d.manual_tier,
  (d.linked_user_id is not null)                             as has_app_account,

  -- Multiplication: the point of the tree.
  (select count(*) from public.disciples c where c.parent_id = d.id)::int
                                                             as direct_disciples,
  (select count(*) from descendants x where x.ancestor_id = d.id)::int
                                                             as total_descendants,

  (current_date - d.created_at::date)                        as days_since_added,
  extract(month from d.birthday)::int                        as birthday_month,

  coalesce(att.sessions_recorded, 0)::int                    as sessions_recorded,
  coalesce(att.sessions_present, 0)::int                     as sessions_present,
  case
    when coalesce(att.sessions_recorded, 0) = 0 then null
    else round(att.sessions_present::numeric / att.sessions_recorded, 2)
  end                                                        as attendance_rate,
  coalesce(abs_.consecutive_absences, 0)::int                as consecutive_absences,
  case
    when att.last_present_on is null then null
    else current_date - att.last_present_on
  end                                                        as days_since_last_present,
  (att.disciple_id is null)                                  as never_recorded
from public.disciples d
left join attendance att on att.disciple_id = d.id
left join recent_absences abs_ on abs_.disciple_id = d.id;

comment on view public.discipleship_signals is
  'De-identified discipleship health signals for AI analysis. Contains no names, emails, phone numbers, birthdays or notes — only opaque refs. See 20260915b migration.';

-- ── The role ────────────────────────────────────────────────────────────────
-- Created without a password, so it cannot authenticate until you set one.
-- Do NOT put the password in this file: migrations are committed to git.
-- Set it once, by hand, in the Supabase SQL editor:
--
--   alter role selah_analyst with password 'a-long-random-password';
--
-- Then store it wherever the agent reads its config from (a GitHub secret),
-- and connect with the pooler connection string, swapping in this role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'selah_analyst') then
    create role selah_analyst with login noinherit;
  end if;
end
$$;

-- Start from nothing, in case the role already existed with grants attached.
revoke all on all tables in schema public from selah_analyst;
revoke all on all sequences in schema public from selah_analyst;
revoke all on all functions in schema public from selah_analyst;
revoke all on schema public from selah_analyst;

-- Then grant back exactly one thing. The view is security_invoker = false, so
-- it runs with its owner's privileges: this role reads the view without ever
-- holding SELECT on disciples or attendance_records underneath it.
grant usage on schema public to selah_analyst;
grant select on public.discipleship_signals to selah_analyst;

-- Future tables must not become readable by default.
alter default privileges in schema public revoke all on tables from selah_analyst;

-- Belt and braces: no ability to write anywhere, ever.
revoke create on schema public from selah_analyst;

-- NOSUPERUSER and NOREPLICATION are deliberately NOT set here. Altering either
-- attribute — even to remove it — requires superuser, and Supabase's `postgres`
-- role is not one, so including them fails the whole migration with:
--   42501: permission denied to alter role
-- They were redundant regardless: CREATE ROLE above grants neither, and a role
-- cannot give itself what it was never granted.
alter role selah_analyst with nocreatedb nocreaterole;
