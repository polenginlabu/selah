-- The SELAH agent brief asks for two things the original table had nowhere to
-- put: supporting scriptures (format section 7) and the "research sources were
-- unavailable today" disclosure (section 11). Both are additive.
alter table public.daily_devotions
  add column if not exists supporting_scriptures jsonb not null default '[]'::jsonb,
  add column if not exists research_note text;

comment on column public.daily_devotions.supporting_scriptures is
  '2-4 supporting Bible references, no text.';

comment on column public.daily_devotions.research_note is
  'Set when the agent could not research, per section 11 of the SELAH brief. Null means research ran.';

-- trusted_teachers entries now carry the official URL the agent actually read.
comment on column public.daily_devotions.trusted_teachers is
  'Array of {teacher, point, source}. Only entries with a verifiable source URL are stored; see scripts/selah/devotion.js.';
