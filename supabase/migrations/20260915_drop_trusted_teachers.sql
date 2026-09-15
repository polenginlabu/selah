-- Research sources are internal now.
--
-- The SELAH brief treats Rick Warren, Vlad Savchuk and others as research
-- input that shapes the writing, not as material to quote: their names are not
-- meant to reach the reader, so there is nothing to store. The devotional is
-- Scripture and reflection, not a reading list.
alter table public.daily_devotions drop column if exists trusted_teachers;
