-- Does the INSERT policy pass for your actual user?
--
-- The SQL editor runs as a superuser, which bypasses RLS entirely — so a plain
-- insert here would succeed and prove nothing. This impersonates the
-- authenticated role and supplies the same JWT claims PostgREST would, which
-- is as close as we can get to the real request without a browser.
--
-- Everything runs inside a transaction that is rolled back, so nothing is
-- written. Run the whole thing and send back the two result rows.

begin;

-- Become the role PostgREST uses for a signed-in user, and hand it the claims
-- your session actually carries.
set local role authenticated;
set local request.jwt.claims = '{"sub":"3cebc884-66a5-4ea6-8b30-c5610663a458","role":"authenticated"}';

-- RESULT 1 — what the database thinks it sees.
-- uid_resolved must be 3cebc884-66a5-4ea6-8b30-c5610663a458.
-- If it is NULL, auth.uid() cannot read the claims and every policy comparing
-- against it fails — that is the whole bug, and it is an auth/JWT problem
-- rather than anything to do with goals.
select
  auth.uid()                                   as uid_resolved,
  current_user                                 as running_as,
  current_setting('request.jwt.claims', true)  as claims_seen;

-- RESULT 2 — does the policy's own expression evaluate true?
-- policy_passes tells us whether the WITH CHECK would allow the row.
select
  auth.uid() = '3cebc884-66a5-4ea6-8b30-c5610663a458'::uuid as policy_passes;

-- The real thing. If the two selects above look right but this raises
-- 42501, the cause is something other than the expression — a restrictive
-- policy, or a trigger rewriting the row.
insert into public.goals (user_id, name, target_date)
values ('3cebc884-66a5-4ea6-8b30-c5610663a458', 'sql rls test', '2026-12-01')
returning id, user_id, name;

rollback;
