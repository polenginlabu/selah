-- Shared cache of generated Bible read-aloud audio (the bible-tts Edge Function).
--
-- Every chunk the function generates with Gemini TTS is stored here once, keyed
-- by model/voice/style/translation/<sha256 of prompt>.wav, and served from here
-- to every later listener on any device without another Gemini call.
--
-- Private on purpose, with NO storage.objects policies: RLS denies anon and
-- authenticated clients any read, list, insert, update or delete. Only the
-- Edge Function's service role (which bypasses RLS) touches this bucket, so the
-- audio of licensed translations is never directly downloadable and no client
-- can plant audio for others to hear.
--
-- Size: 24 kHz 16-bit mono WAV is ~48 KB a second, ~1 MB per 280-char chunk,
-- 5-15 MB a typical chapter per voice+style.
--
-- Rollback (empty the bucket first; storage refuses to drop a non-empty one):
--   delete from storage.objects where bucket_id = 'bible-audio';
--   delete from storage.buckets where id = 'bible-audio';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bible-audio',
  'bible-audio',
  false,
  8388608,                           -- 8 MB guard; a 1200-char chunk is ~4 MB
  array['audio/wav']
)
on conflict (id) do nothing;
