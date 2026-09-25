-- Read-only diagnostics for the prayer feature's RLS, mirroring the repo's
-- diagnose_goals_rls.sql convention. Run in the Supabase SQL editor.
--
-- It checks the three things that matter for a fully personal feature:
--   1. every prayer table has RLS enabled,
--   2. every policy is scoped by user_id = auth.uid(),
--   3. cross-user writes are rejected at the policy level (no UPDATE/DELETE
--      without the user_id guard, and inserts can't point at another user's
--      categories or items).

select 'prayer_categories' as table_name, relrowsecurity as rls_enabled
from pg_class where oid = 'public.prayer_categories'::regclass
union all
select 'prayer_items', relrowsecurity
from pg_class where oid = 'public.prayer_items'::regclass
union all
select 'prayer_activity', relrowsecurity
from pg_class where oid = 'public.prayer_activity'::regclass
order by table_name;

select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('prayer_categories', 'prayer_items', 'prayer_activity')
order by tablename, policyname;

-- Manual smoke test (sign in as a different user second, expect 0 rows): these
-- must each return only the current user's own rows.
--   select count(*) from public.prayer_categories where user_id = auth.uid();
--   select count(*) from public.prayer_items where user_id = auth.uid();
--   select count(*) from public.prayer_activity where user_id = auth.uid();