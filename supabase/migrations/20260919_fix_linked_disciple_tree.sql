-- Fix: a disciple linked to a real account could not see the network the
-- leader built under them. get_disciple_tree only pulled a linked member's own
-- tree into the LEADER's view; it never pulled the leader's tree into the
-- MEMBER's view, so a member's tree showed only their own (usually empty) root.
--
-- Now, when the caller is linked to a disciple node inside a leader's tree,
-- that node and its descendants are included (re-parented under the caller's
-- own root so the client draws them), marked is_foreign so the caller knows it
-- is managed by the leader. The leader's existing view is unchanged.

create or replace function public.get_disciple_tree()
returns table (
  id uuid,
  tree_owner_id uuid,
  parent_id uuid,
  linked_user_id uuid,
  name text,
  birthday date,
  mobile_number text,
  notes text,
  email text,
  generation integer,
  lifetime_phase smallint,
  manual_tier text,
  created_at timestamp with time zone,
  is_foreign boolean,
  owner_name text
)
language sql
stable
security definer
set search_path = public
as $function$
  with recursive
  subtree as (
    -- The linked node this account is attached to inside a leader's tree,
    -- plus everyone beneath it, at any depth.
    select
      d.id, d.tree_owner_id, d.parent_id, d.linked_user_id, d.name, d.birthday,
      d.mobile_number, d.notes, d.email, d.generation, d.lifetime_phase, d.manual_tier, d.created_at,
      0 as s_depth
    from public.disciples d
    where d.linked_user_id = auth.uid()
      and d.tree_owner_id <> auth.uid()
    union all
    select
      child.id, child.tree_owner_id, child.parent_id, child.linked_user_id, child.name, child.birthday,
      child.mobile_number, child.notes, child.email, child.generation, child.lifetime_phase, child.manual_tier, child.created_at,
      s.s_depth + 1
    from subtree s
    join public.disciples child
      on child.parent_id = s.id
      and child.tree_owner_id = s.tree_owner_id
  ),
  base as (
    -- The caller's own tree.
    select
      d.id, d.tree_owner_id, d.parent_id, d.linked_user_id, d.name, d.birthday,
      d.mobile_number, d.notes, d.email, d.generation, d.lifetime_phase, d.manual_tier, d.created_at,
      false as is_foreign,
      null::text as owner_name,
      0 as depth
    from public.disciples d
    where d.tree_owner_id = auth.uid()

    union

    -- The linked node's subtree, re-parented under the caller's own root so it
    -- draws in their tree. owner_name carries the leader's name.
    select
      s.id, s.tree_owner_id,
      case when s.s_depth = 0
        then (select root.id from public.disciples root
               where root.tree_owner_id = auth.uid() and root.parent_id is null)
        else s.parent_id end as parent_id,
      s.linked_user_id, s.name, s.birthday, s.mobile_number, s.notes, s.email,
      s.generation, s.lifetime_phase, s.manual_tier, s.created_at,
      true as is_foreign,
      (select root.name from public.disciples root
         where root.tree_owner_id = s.tree_owner_id and root.parent_id is null) as owner_name,
      0 as depth
    from subtree s
  ),
  tree as (
    select * from base

    union

    -- A leader also sees the network a linked member builds in their own tree,
    -- re-parented so it hangs off the linked disciple node.
    select
      d.id, d.tree_owner_id,
      case when d.parent_id = froot.id then t.id else d.parent_id end as parent_id,
      d.linked_user_id, d.name, d.birthday, d.mobile_number, d.notes, d.email,
      d.generation + t.generation as generation,
      d.lifetime_phase, d.manual_tier, d.created_at,
      true as is_foreign,
      t.name as owner_name,
      t.depth + 1 as depth
    from tree t
    join public.disciples froot
      on froot.tree_owner_id = t.linked_user_id and froot.parent_id is null
    join public.disciples d
      on d.tree_owner_id = t.linked_user_id and d.id <> froot.id
    where t.linked_user_id is not null
      and t.linked_user_id <> t.tree_owner_id
      and t.depth < 25
  )
  select id, tree_owner_id, parent_id, linked_user_id, name, birthday,
         mobile_number, notes, email, generation, lifetime_phase, manual_tier, created_at, is_foreign, owner_name
  from tree;
$function$;

revoke all on function public.get_disciple_tree() from public;
grant execute on function public.get_disciple_tree() to authenticated;