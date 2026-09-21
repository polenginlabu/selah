-- Work handed to the OpenCode agent, run in GitHub Actions.
--
-- WHY A TABLE RATHER THAN A DIRECT CALL
--
-- The agent used to be reached synchronously through a bridge running on the
-- web host. That could not hold: the shared plan's process limiter killed
-- OpenCode whenever it did real work, silently, leaving no error to read — a
-- log of thirty consecutive "listening" lines and nothing else.
--
-- So the agent now runs where there is room for it: a GitHub Actions runner,
-- which installs OpenCode, uses it, and is thrown away. Nothing has to stay
-- alive between runs. The same shape the nightly devotion already uses.
--
-- That makes the work ASYNCHRONOUS — a runner takes a few minutes to start —
-- so a job needs somewhere to live while it runs. This is that place: the app
-- inserts a queued row, the workflow claims it, and the app watches for the
-- result. A browser that closes mid-run loses nothing.

create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),

  -- 'ask'           free-form question, answered as prose
  -- 'consolidation' the discipleship report, answered as JSON
  kind text not null check (kind in ('ask', 'consolidation')),

  -- What was asked. For consolidation this is null and the task is built by
  -- the script, so the stored prompt can never drift from what actually ran.
  prompt text,
  -- Optional 8-char opaque disciple ref, for a consolidation scoped to one
  -- person. Never a name — see 20260915b_discipleship_signals.sql.
  scope_ref text check (scope_ref is null or scope_ref ~ '^[0-9a-f]{1,8}$'),

  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),

  -- Prose for 'ask', JSON for 'consolidation'. Kept as text either way so a
  -- model that returns something unparseable is still inspectable rather than
  -- rejected by the column type.
  result text,
  error text,
  model text,

  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- The panel lists a user's recent jobs newest-first, and the workflow looks a
-- job up by id, so those are the two accesses worth indexing.
create index if not exists agent_jobs_requested_by_created
  on public.agent_jobs (requested_by, created_at desc);

comment on table public.agent_jobs is
  'Queued work for the OpenCode agent, executed by the agent-job GitHub workflow. Rows are created by admins and written back by the service role.';

alter table public.agent_jobs enable row level security;

-- A requester reads their own jobs. There is no insert/update/delete policy,
-- so RLS denies writes to every client: rows are created by the trigger-agent
-- Edge Function and completed by the workflow, both of which use the service
-- role and bypass RLS. That keeps "who may run the agent" a single decision
-- made in one place (is_admin) rather than a policy that has to be kept in
-- step with it.
drop policy if exists "Requesters read their own agent jobs" on public.agent_jobs;
create policy "Requesters read their own agent jobs"
  on public.agent_jobs
  for select
  to authenticated
  using (requested_by = auth.uid());
