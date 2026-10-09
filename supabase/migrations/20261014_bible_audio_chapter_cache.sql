-- Bible read-aloud is cached per chapter (the bible-tts Edge Function).
--
-- One object per chapter track instead of one per ~1k-character chunk:
-- ElevenLabs MP3 (128 kbps, ~1 MB a minute) with a small JSON of verse start
-- times beside it, or Gemini WAV (24 kHz 16-bit mono, ~2.9 MB a minute).
-- 20261012 only allowed audio/wav up to 8 MB, which rejects both.
--
-- Unchanged: the bucket stays private with NO storage.objects policies; only
-- the Edge Function's service role reads or writes it.
--
-- 50 MB is the default project-wide upload cap on Supabase; a Gemini chapter
-- over ~17 minutes is larger and is played but not cached (the write is
-- logged as failed).
--
-- Apply after 20261011_tts_rate_limit.sql, 20261012_bible_audio_cache.sql and
-- 20261013_tts_model_exhaustion.sql, in that order.
--
-- Rollback (restores the 20261012 limits; chapter tracks already stored stay
-- readable, new MP3 and JSON writes fail):
--   update storage.buckets
--     set file_size_limit = 8388608, allowed_mime_types = array['audio/wav']
--     where id = 'bible-audio';

update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array['audio/mpeg', 'audio/wav', 'application/json']
where id = 'bible-audio';
