-- The plan behind a target: who is bringing how many, and from where.
--
--   Target: 16 VIP
--     - JM ....... 5   "winning at UCC"
--     - Marbhim .. 2   "gathering from campus"
--     => 7 pledged, 9 still unaccounted for
--
-- Deliberately SEPARATE from goal_items.current_value. A pledge is what
-- someone has committed to bring; current_value is who actually turned up.
-- Collapsing the two would mean the count going up because of a promise, and
-- a leader could not tell a planned 16 from an attended 16 — which is the one
-- thing this page exists to show them.
--
-- Depends on 20260911_goals.sql.

create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.goal_items(id) on delete cascade,
  who text not null check (length(trim(who)) > 0),
  -- Named `pledged`, not `count`: COUNT is a function name, and a column that
  -- shadows one is a needless source of ambiguous SQL later.
  pledged integer not null default 0 check (pledged >= 0),
  note text,
  -- Marks a pledge as delivered. Informational only — it does NOT move
  -- current_value, for the reason in the header.
  fulfilled boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists goal_contributions_item_id_idx
  on public.goal_contributions (item_id, created_at);

alter table public.goal_contributions enable row level security;

-- Ownership resolves two hops up: contribution -> item -> goal -> user. Same
-- pattern as goal_items, so there remains exactly one definition of who owns
-- what, on public.goals.
drop policy if exists "Users manage contributions on their own goals" on public.goal_contributions;
create policy "Users manage contributions on their own goals"
  on public.goal_contributions
  for all
  using (
    exists (
      select 1
      from public.goal_items i
      join public.goals g on g.id = i.goal_id
      where i.id = goal_contributions.item_id and g.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.goal_items i
      join public.goals g on g.id = i.goal_id
      where i.id = goal_contributions.item_id and g.user_id = auth.uid()
    )
  );
