-- Extend the reader's highlight palette from four colors to six.
--
-- The palette itself lives in src/lib/highlights.js; the ids are the contract
-- stored in `bible_highlights` rows, so the server-side validator that guards
-- those rows (created in 20260923_bible_highlights.sql) must accept the two
-- new ids before app code can sync them to the account copy. Recreating the
-- trigger-bound function here is safer than editing the old migration, which
-- is already applied. The trigger itself (bible_highlights_validate_verses)
-- references the function by name and keeps working after the replace.
--
-- The full original body is preserved — entry cap and all — with the color
-- whitelist extended, and two hardening tweaks applied to the new body:
--   * jsonb_each_text() yields SQL NULL for a JSON null value, and `NULL NOT
--     IN (...)` is NULL, so `{"1": null}` previously skipped the color check;
--     the value is now rejected explicitly.
--   * key lengths are bounded to 1..4 digits so a hostile client cannot push
--     unbounded-size keys past the 300-entry cap.
-- Old four-color data is untouched and remains valid.

create or replace function public.validate_bible_highlights_verses()
returns trigger
language plpgsql
as $$
declare
  entry record;
  n int := 0;
begin
  if jsonb_typeof(new.verses) <> 'object' then
    raise exception 'bible_highlights.verses must be a JSON object';
  end if;
  for entry in select key, value from jsonb_each_text(new.verses) loop
    n := n + 1;
    if n > 300 then
      raise exception 'bible_highlights.verses has more than 300 entries';
    end if;
    if entry.key !~ '^(0|[1-9][0-9]{0,3})$' then
      raise exception 'bible_highlights.verses key is not a bounded verse number: %', entry.key;
    end if;
    if entry.value is null or entry.value not in ('yellow', 'pink', 'green', 'blue', 'purple', 'orange') then
      raise exception 'bible_highlights.verses has an invalid highlight color: %', entry.value;
    end if;
  end loop;
  return new;
end;
$$;