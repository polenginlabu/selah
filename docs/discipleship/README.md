# SELAH Discipleship AI — Consolidation

AI-assisted discipleship consolidation for the G12 journey
(**WIN → CONSOLIDATE → DISCIPLE → SEND**), grounded in the church's own
teaching and powered by your existing **OpenCode bridge**.

This is the "Generate consolidation" feature: an admin opens **Discipleship →
My Tree**, taps **Consolidation**, and the server-side OpenCode agent reads the
de-identified `discipleship_signals` view, reasons over the church knowledge
base, and returns a summary of who needs follow-up plus per-person guides.

## How it fits together

```
Leader (browser)
  └─ DiscipleTree page ── "Consolidation" button (admin only)
       │  POST /functions/v1/bridge-admin   { action: 'consolidation' }
       │     • auth: user JWT + is_admin() in Postgres
       │     • BRIDGE_TOKEN stays server-side
       ▼
  bridge-admin ── POST /api/sessions ── POST /api/chat/start ── poll /api/chat/status/:id
       ▼
  OpenCode serve (the bridge agent)
       • reads docs/discipleship/agent-prompt.md    (system prompt)
       • reads docs/discipleship/knowledge-base.md  (the ONLY source of procedure)
       • queries public.discipleship_signals as the selah_analyst role (read-only)
       ▼
  structured JSON (keyed by opaque ref) ──► app maps ref → real person, renders
```

### Why this replaces the original RAG+pgvector plan

The original spec assumed a bespoke `selah-ai` Edge Function doing vector search
over an embedded knowledge base and calling Gemini directly. You already have
the server-side agent and a purpose-built, de-identified DB surface, so:

- **No pgvector / embeddings / vector store.** Church guidance is small and
  bounded; the agent reads it from `docs/discipleship/knowledge-base.md` on the
  server instead of a vector index.
- **No Gemini key plumbing.** The bridge already owns model selection.
- **No new CRM.** `disciples` + `attendance_records` already model people and
  visits; `discipleship_signals` derives the health signals in SQL.
- **Least privilege by construction.** The agent reads only the de-identified
  view as a read-only role, so it can never see names, contacts, or pastoral
  notes, and can never write.

## Files

| Path | Purpose |
| --- | --- |
| `docs/discipleship/knowledge-base.md` | The church's approved G12 teaching — the agent's only source of church procedure. |
| `docs/discipleship/agent-prompt.md` | System prompt + output JSON schema for the agent. |
| `supabase/functions/bridge-admin/index.ts` | Edge Function: admin-gated bridge gateway + `consolidation` orchestration. |
| `src/data/consolidation.js` | Frontend: calls `bridge-admin`, normalizes the report. |
| `src/lib/discipleship.js` | Pure helpers (ref mapping, normalization) — unit-tested. |
| `src/lib/discipleship.test.js` | Tests for ref mapping + report normalization. |
| `src/components/ConsolidationPanel.jsx` | Renders the summary + per-person cards. |
| `src/pages/DiscipleTree.jsx` | "Consolidation" button (admin only) + panel. |

## Database

No new migrations were needed. The feature reuses:

- `public.disciples` + `public.attendance_records` (existing people/visits).
- `public.discipleship_signals` view + `selah_analyst` role
  (`20260915b_discipleship_signals.sql`).

`discipleship_signals` exposes only de-identified refs and health signals, so no
personal data ever reaches the model provider. Ref = `left(id::text, 8)`; the
app maps refs back to names client-side.

## Environment variables (edge function)

| Secret | Meaning |
| --- | --- |
| `BRIDGE_URL` | Base URL of the bridge (reverse proxy in front of `opencode serve`). |
| `BRIDGE_TOKEN` | Bearer token; must match the token the bridge accepts. |
| `CONSOLIDATION_TIMEOUT_MS` | Optional. Wait budget for the agent (default `150000`). |
| `CHAT_ALLOWED_ORIGIN` | Optional. CORS origin (default `*`). |

```sh
supabase secrets set BRIDGE_URL=https://your-host/bridge
supabase secrets set BRIDGE_TOKEN=the-same-value-as-on-the-bridge
```

## Server-side prerequisites (must exist for the button to work)

1. **opencode serve + the opencode-bridge running** on the server. The bridge
   (an Express server, `backend/bridge/`) proxies the agent. The function uses
   the bridge's job API:
   - `POST /api/sessions` `{ title }` — create + activate a fresh session
   - `POST /api/chat/start` `{ message, model }` — start a job, returns `jobId`
   - `GET /api/chat/status/:jobId` — poll until `done`, read `response`
2. **`public/bridge.php` deployed with the new whitelist.** It is the public
   gateway to the loopback bridge (Hostinger). It now forwards `POST
   /api/sessions`, `POST /api/chat/start`, and `GET /api/chat/status/<jobId>`
   (jobId validated) in addition to `health`/`models`/`model`. This file ships
   with the site, so it goes live on the next normal deploy (GitHub Actions →
   rsync).
2. **The SELAH repo checked out on that server**, so the agent can read
   `docs/discipleship/*`.
3. **The `selah_analyst` role with a password**, and a pooler connection string
   using that role available in the agent's environment (e.g. `DATABASE_URL`).
   Follow the instructions in `20260915b_discipleship_signals.sql`:
   `alter role selah_analyst with password '<random>';` — never commit the
   password.
4. **Model configured** on the bridge (or via `set-model`).

## Deploy

The consolidation run can take over a minute. Deploy the function (the CLI in
use here does not accept a `--timeout` flag, so configure the timeout in
`supabase/config.toml`):

```sh
supabase functions deploy bridge-admin
```

```toml
# supabase/config.toml
[functions.bridge-admin]
verify_jwt = true
# Match or exceed the wait budget (see CONSOLIDATION_TIMEOUT_MS, default 150s).
timeout = 300
```

## Local development

- Edge function: `supabase functions serve bridge-admin` (set the secrets above).
- Frontend: `npm run dev`.
- Tests: `npm run card:test` (includes `src/lib/discipleship.test.js`).

## Security notes

- Admin-gated: only authenticated admins (`is_admin`) can trigger a run.
- `BRIDGE_TOKEN` and `selah_analyst` credentials are never in the browser.
- The agent only reads the de-identified view with a read-only role — RAG-style
  prompts cannot bypass RLS because there is no broader grant.
- Ref → name mapping happens client-side, so names are never sent to the model.

## Remaining TODOs

- Redeploy the site so the updated `public/bridge.php` whitelist goes live
  (GitHub Actions → rsync), then confirm `/api/chat/start` is reachable through
  it (server side).
- Point the agent's environment at the `selah_analyst` connection string.
- Optional: a `follow_ups` table if leaders later need to persist outcomes
  (currently derived from attendance).
- Optional: per-person drill-down button (the edge function already accepts a
  `ref`); wire the "view person" action in the UI.