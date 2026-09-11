-- Diagnostic for "new row violates row-level security policy" on goals.
--
-- ONE query on purpose: the Supabase SQL editor only displays the result of
-- the last statement, so a multi-statement script silently hides everything
-- above it. Read-only. Run it and send the whole table back.
--
-- What to look for, in order of likelihood:
--   * a missing "policy | goals [INSERT]" row  -> RLS on with no INSERT policy
--     denies every write. Re-run 20260911c_goal_participants.sql.
--   * "grant | goals -> authenticated" missing INSERT -> the plain GRANT is
--     checked BEFORE any policy, so this denies the write first.
--   * rls = false anywhere -> a table is unprotected, a different problem.

select 'policy' as kind,
       tablename || ' [' || cmd || ']' as subject,
       policyname as detail,
       coalesce(with_check, qual, '(none)') as expression
from pg_policies
where schemaname = 'public'
  and tablename in ('goals', 'goal_items', 'goal_contributions', 'goal_participants')

union all

select 'rls',
       relname,
       case when relrowsecurity then 'enabled' else 'DISABLED' end,
       ''
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('goals', 'goal_items', 'goal_contributions', 'goal_participants')

union all

select 'grant',
       table_name || ' -> ' || grantee,
       string_agg(privilege_type, ', ' order by privilege_type),
       ''
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('goals', 'goal_items', 'goal_contributions', 'goal_participants')
  and grantee in ('anon', 'authenticated')
group by table_name, grantee

union all

select 'function',
       proname,
       case when prosecdef then 'security definer' else 'INVOKER' end,
       'owner=' || pg_get_userbyid(proowner)
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('can_access_goal', 'owns_goal', 'can_access_goal_item', 'owns_goal_item')

order by kind, subject, detail;
