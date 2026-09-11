-- Fixes: creating a goal fails with
--   42501 new row violates row-level security policy for table "goals"
-- even though the INSERT policy, grants and JWT are all correct.
--
-- CAUSE
-- The client inserts with .select(), so Postgres adds RETURNING — and
-- RETURNING evaluates the SELECT policy against the row just written. That
-- policy was `can_access_goal(id)`, and can_access_goal is STABLE, so it reads
-- the snapshot taken at the START of the statement: a snapshot in which the
-- new row does not exist yet. It finds nothing, returns false, and the insert
-- is rejected on the way out.
--
-- FIX
-- Check ownership inline first. `user_id = auth.uid()` reads the NEW row
-- directly from the tuple being returned, with no lookup and no snapshot to
-- be stale, so an owner reading back their own row always passes. The function
-- call remains for the participant case, where the goal already existed and
-- the snapshot is fine.
--
-- This is also cheaper: the common case no longer calls a function at all.
--
-- Depends on 20260911c_goal_participants.sql.

drop policy if exists "Participants can read goals" on public.goals;
create policy "Participants can read goals" on public.goals
  for select using (
    user_id = auth.uid()
    or public.can_access_goal(id)
  );

-- goal_items and goal_contributions do not need the same treatment: their
-- policies look up the PARENT goal, which already exists when a child row is
-- inserted, so the stale-snapshot problem cannot arise. Left alone
-- deliberately rather than changed for symmetry.
