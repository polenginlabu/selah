-- Group Targets: attendance goals per event, each with one or more countable
-- items (VIP, Regular, or anything the leader names).
--
-- Scoped per user like the rest of the app. A goal belongs to the leader who
-- created it; item access is derived from the parent goal rather than stored
-- again, so there is one place where ownership is decided and no way for the
-- two to disagree.

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  target_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists goals_user_id_idx on public.goals (user_id, target_date);

create table if not exists public.goal_items (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  target integer not null check (target > 0),
  -- Named current_value, not "current": CURRENT is a keyword in enough SQL
  -- contexts that an unquoted column of that name is a trap waiting to happen.
  current_value integer not null default 0 check (current_value >= 0),
  created_at timestamptz not null default now()
);

create index if not exists goal_items_goal_id_idx on public.goal_items (goal_id, created_at);

alter table public.goals enable row level security;
alter table public.goal_items enable row level security;

drop policy if exists "Users manage their own goals" on public.goals;
create policy "Users manage their own goals"
  on public.goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Ownership is inherited from the parent goal. USING governs what you may read
-- and change; WITH CHECK governs what a row may become, so both are needed —
-- without WITH CHECK you could move one of your items under someone else's
-- goal, and without USING you could read theirs.
drop policy if exists "Users manage items on their own goals" on public.goal_items;
create policy "Users manage items on their own goals"
  on public.goal_items
  for all
  using (
    exists (
      select 1 from public.goals g
      where g.id = goal_items.goal_id and g.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.goals g
      where g.id = goal_items.goal_id and g.user_id = auth.uid()
    )
  );
