-- Collapse duplicate root rows down to one per tree owner, then make a second
-- root impossible.
--
-- getOrCreateRootDisciple read-then-inserted with nothing enforcing
-- uniqueness, so two concurrent calls (a StrictMode double-mount, a second
-- tab) could each see "no root yet" and each insert one. The read had no
-- ORDER BY either, so which duplicate the app treated as "your" root varied
-- between loads — and any disciple added while a losing root was selected
-- became invisible in the tree while still counting toward the generation
-- totals on the G12 / Conquest cards.
--
-- disciples_parent_id_fkey is ON DELETE SET NULL, so children of a losing root
-- must be re-parented *before* that row is deleted or they'd be orphaned with
-- a null parent_id and unreachable for good.

begin;

create temporary table root_dedupe on commit drop as
with roots as (
  select
    d.id,
    d.tree_owner_id,
    d.created_at,
    (select count(*) from public.disciples c where c.parent_id = d.id) as child_count
  from public.disciples d
  where d.parent_id is null
    and d.generation = 0
)
select
  id,
  tree_owner_id,
  row_number() over (
    partition by tree_owner_id
    order by child_count desc, created_at asc, id asc
  ) as rn
from roots;

-- Keep the root with the most children (tie broken by age): that's the one the
-- tree has effectively been built under.
update public.disciples c
set parent_id = keeper.id
from root_dedupe dup
join root_dedupe keeper
  on keeper.tree_owner_id = dup.tree_owner_id
 and keeper.rn = 1
where dup.rn > 1
  and c.parent_id = dup.id;

-- Both roots sat at depth 0, so re-parented children keep generation 1 and
-- their own descendants are unaffected — no generation rewrite needed.

delete from public.disciples d
using root_dedupe dup
where d.id = dup.id
  and dup.rn > 1;

create unique index if not exists disciples_one_root_per_owner
  on public.disciples (tree_owner_id)
  where parent_id is null and generation = 0;

commit;
