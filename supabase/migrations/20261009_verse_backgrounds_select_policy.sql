-- Verse-background storage reads and replaces for admins.
--
-- The admin panel uploads with `upsert: true` and removes objects through the
-- Storage API. Storage runs those as INSERT ... ON CONFLICT DO UPDATE ...
-- RETURNING and as a lookup-then-delete on storage.objects, so the caller must
-- be able to SELECT the rows it writes. Admins (public.is_admin()) get that
-- read here; nobody else does.
--
-- The bucket is public, so image URLs (/storage/v1/object/public/...) are
-- served without any policy. Writes stay admin-only.

-- ---------------------------------------------------------------------------
-- Storage read policy — admins only
-- ---------------------------------------------------------------------------

drop policy if exists "Admins read verse backgrounds" on storage.objects;
create policy "Admins read verse backgrounds"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'verse-backgrounds' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage replace policy — admins only
-- ---------------------------------------------------------------------------

-- USING picks the existing object the upsert may overwrite; WITH CHECK gates
-- the replacement row. Both carry the same admin expression.
drop policy if exists "Admins replace verse backgrounds" on storage.objects;
create policy "Admins replace verse backgrounds"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'verse-backgrounds' and public.is_admin())
  with check (bucket_id = 'verse-backgrounds' and public.is_admin());
