-- Materialise recurring Conquest items into a week exactly once.
--
-- conquest_weeks keeps one row per (user_id, week_start) with the week's items
-- as a jsonb array, so uniqueness per (recurring item, week) cannot be a
-- table key. Instead each row records which recurring ids were already applied
-- (recurring_applied), and apply_conquest_recurring appends new instances
-- under a row lock. Concurrent calls (two tabs, reloads, StrictMode double
-- effects) serialise on the lock; the later one finds the ids recorded and the
-- (date, title) pairs present and adds nothing. An instance the user deletes is
-- not recreated because its recurring id stays recorded.
--
-- SECURITY INVOKER: the caller's existing conquest_weeks RLS policies apply,
-- and the user is always auth.uid(), never a parameter.
--
-- Rollback: drop function public.apply_conquest_recurring(date, jsonb, jsonb);
-- the recurring_applied column is ignored by older clients and can stay.

alter table public.conquest_weeks
  add column if not exists recurring_applied jsonb not null default '[]'::jsonb;

-- ON CONFLICT (user_id, week_start) needs a non-partial unique index on exactly
-- those columns. The client already upserts on that key, so one should exist;
-- create it only if it does not.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.conquest_weeks'::regclass
      and i.indisunique
      and i.indpred is null
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(i.indkey) as k(attnum)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      ) = array['user_id', 'week_start']
  ) then
    create unique index conquest_weeks_user_week_key
      on public.conquest_weeks (user_id, week_start);
  end if;
end;
$$;

-- Existing rows: treat a recurring item as already applied to a week if any
-- item in that week carries its title, so instances the user deleted before
-- this migration are not recreated on the next load.
update public.conquest_weeks w
set recurring_applied = coalesce((
  select jsonb_agg(distinct to_jsonb(r.id::text))
  from public.conquest_recurring r
  where r.user_id = w.user_id
    and exists (
      select 1
      from jsonb_array_elements(coalesce(w.items, '[]'::jsonb)) as x
      where x->>'title' = r.title
    )
), '[]'::jsonb)
where w.recurring_applied = '[]'::jsonb;

create or replace function public.apply_conquest_recurring(
  p_week_start date,
  p_items jsonb,
  p_recurring_ids jsonb
)
returns public.conquest_weeks
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.conquest_weeks;
  v_new jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_typeof(p_recurring_ids) is distinct from 'array' then
    raise exception 'p_items and p_recurring_ids must be json arrays' using errcode = '22023';
  end if;

  insert into public.conquest_weeks (user_id, week_start, items)
  values (v_uid, p_week_start, '[]'::jsonb)
  on conflict (user_id, week_start) do nothing;

  select * into v_row
  from public.conquest_weeks
  where user_id = v_uid and week_start = p_week_start
  for update;

  if not found then
    return null;
  end if;

  -- Only instances inside this week, from a recurring id not yet applied, and
  -- whose (date, title) is not already in the stored items.
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_new
  from jsonb_array_elements(p_items) as e
  where jsonb_typeof(e) = 'object'
    and coalesce(e->>'recurringId', '') <> ''
    and coalesce(e->>'title', '') <> ''
    and case
      when (e->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
        then (e->>'date')::date between p_week_start and p_week_start + 6
      else false
    end
    and not (v_row.recurring_applied ? (e->>'recurringId'))
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(v_row.items, '[]'::jsonb)) as x
      where x->>'date' = e->>'date' and x->>'title' = e->>'title'
    );

  -- Nothing new to add or record: skip the write (and the realtime event).
  if v_new = '[]'::jsonb and p_recurring_ids <@ v_row.recurring_applied then
    return v_row;
  end if;

  update public.conquest_weeks
  set items = coalesce(items, '[]'::jsonb) || v_new,
      recurring_applied = (
        select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
        from (
          select jsonb_array_elements(v_row.recurring_applied) as v
          union all
          select jsonb_array_elements(p_recurring_ids)
        ) s
        where jsonb_typeof(v) = 'string'
      )
  where user_id = v_uid and week_start = p_week_start
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.apply_conquest_recurring(date, jsonb, jsonb) from public, anon;
grant execute on function public.apply_conquest_recurring(date, jsonb, jsonb) to authenticated;
