-- Shared goals: a leader can invite disciples to work on a target together,
-- and it then appears in those disciples' own Goals page.
--
-- Only disciples with linked_user_id set can be invited — a manual disciple is
-- a name on a tree with no account to show anything in.
--
-- Depends on 20260911_goals.sql and 20260911b_goal_contributions.sql.

create table if not exists public.goal_participants (
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Which disciple row this came from, for display. ON DELETE SET NULL so
  -- removing someone from the tree doesn't silently drop them from a goal
  -- they're actively working on.
  disciple_id uuid references public.disciples(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (goal_id, user_id)
);

create index if not exists goal_participants_user_id_idx on public.goal_participants (user_id);

alter table public.goal_participants enable row level security;

-- Track who wrote a pledge, so a participant can manage their own without
-- being able to touch anyone else's.
alter table public.goal_contributions
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER is load-bearing here, not laziness. The SELECT policy on
-- goals calls this, and this reads goals — under the caller's own privileges
-- that is infinite RLS recursion. Running as owner bypasses RLS for the check.
-- It is safe to expose because it returns only a boolean about the caller and
-- takes an id the caller already holds.
create or replace function public.can_access_goal(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.goals g
    where g.id = p_goal_id
      and (
        g.user_id = auth.uid()
        or exists (
          select 1 from public.goal_participants p
          where p.goal_id = g.id and p.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.owns_goal(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.goals g where g.id = p_goal_id and g.user_id = auth.uid()
  );
$$;

/** Same questions, asked of an item's parent goal. */
create or replace function public.can_access_goal_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_access_goal((select goal_id from public.goal_items where id = p_item_id));
$$;

create or replace function public.owns_goal_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.owns_goal((select goal_id from public.goal_items where id = p_item_id));
$$;

-- ---------------------------------------------------------------------------
-- Policies — replacing the owner-only ones from the earlier migrations
-- ---------------------------------------------------------------------------
--
-- Every policy is dropped before it is created, so this file is safe to re-run.
-- That matters: a half-applied policy migration leaves RLS enabled with gaps,
-- which denies everything and is not obvious from the error message.
--
-- The split throughout: everyone who can see a goal may move the numbers,
-- because collaborating on a count is the point. Only the owner may change the
-- shape of it — add or remove items, edit the goal, delete it, or change who
-- is involved.

drop policy if exists "Users manage their own goals" on public.goals;

drop policy if exists "Participants can read goals" on public.goals;
create policy "Participants can read goals" on public.goals
  for select using (public.can_access_goal(id));
drop policy if exists "Owners create goals" on public.goals;
create policy "Owners create goals" on public.goals
  for insert with check (auth.uid() = user_id);
drop policy if exists "Owners update goals" on public.goals;
create policy "Owners update goals" on public.goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Owners delete goals" on public.goals;
create policy "Owners delete goals" on public.goals
  for delete using (auth.uid() = user_id);

drop policy if exists "Users manage items on their own goals" on public.goal_items;

drop policy if exists "Participants read items" on public.goal_items;
create policy "Participants read items" on public.goal_items
  for select using (public.can_access_goal(goal_id));
drop policy if exists "Owners add items" on public.goal_items;
create policy "Owners add items" on public.goal_items
  for insert with check (public.owns_goal(goal_id));
-- Participants may update: this is how the live count gets moved.
drop policy if exists "Participants update items" on public.goal_items;
create policy "Participants update items" on public.goal_items
  for update using (public.can_access_goal(goal_id)) with check (public.can_access_goal(goal_id));
drop policy if exists "Owners delete items" on public.goal_items;
create policy "Owners delete items" on public.goal_items
  for delete using (public.owns_goal(goal_id));

drop policy if exists "Users manage contributions on their own goals" on public.goal_contributions;

drop policy if exists "Participants read pledges" on public.goal_contributions;
create policy "Participants read pledges" on public.goal_contributions
  for select using (public.can_access_goal_item(item_id));
drop policy if exists "Participants add pledges" on public.goal_contributions;
create policy "Participants add pledges" on public.goal_contributions
  for insert with check (public.can_access_goal_item(item_id));
-- Your own pledge, or anything on a goal you own.
drop policy if exists "Own pledges or owner" on public.goal_contributions;
create policy "Own pledges or owner" on public.goal_contributions
  for update
  using (public.owns_goal_item(item_id) or created_by = auth.uid())
  with check (public.owns_goal_item(item_id) or created_by = auth.uid());
drop policy if exists "Delete own pledges or owner" on public.goal_contributions;
create policy "Delete own pledges or owner" on public.goal_contributions
  for delete using (public.owns_goal_item(item_id) or created_by = auth.uid());

-- Participants can see who else is involved; only the owner changes the roster.
drop policy if exists "Participants read roster" on public.goal_participants;
create policy "Participants read roster" on public.goal_participants
  for select using (public.can_access_goal(goal_id));
drop policy if exists "Owners add participants" on public.goal_participants;
create policy "Owners add participants" on public.goal_participants
  for insert with check (public.owns_goal(goal_id));
drop policy if exists "Owners remove participants" on public.goal_participants;
create policy "Owners remove participants" on public.goal_participants
  for delete using (public.owns_goal(goal_id));

revoke all on function public.can_access_goal(uuid) from public;
revoke all on function public.owns_goal(uuid) from public;
revoke all on function public.can_access_goal_item(uuid) from public;
revoke all on function public.owns_goal_item(uuid) from public;
grant execute on function public.can_access_goal(uuid) to authenticated;
grant execute on function public.owns_goal(uuid) to authenticated;
grant execute on function public.can_access_goal_item(uuid) to authenticated;
grant execute on function public.owns_goal_item(uuid) to authenticated;
