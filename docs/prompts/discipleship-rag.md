# SELAH — AI discipleship assistant: agent brief

How to use this file with the OpenCode bridge, and the brief itself.

---

## How to run it

The bridge is not a chat window — it is a job runner with hard limits, and they
decide how this brief has to be shaped:

| Limit | Value | Where |
| --- | --- | --- |
| Job deadline | 10 min (client gives up at 9) | `server.js`, `scripts/selah/bridge.js` |
| Stall kill, tool running | 60 s with no change | `server.js` |
| Stall kill, otherwise | 120 s with no change | `server.js` |
| Reply | ONE final text blob | `/api/chat/result` |

**A single job cannot build this feature.** The whole system is weeks of work;
nine minutes is roughly one migration, or one Edge Function, or one screen. So
run it as a sequence of jobs — send **Context** plus exactly **one Phase**, take
the report, then send the next.

```bash
opencode serve --port 4097
cd backend/bridge/opencode-bridge && npm start      # 4098
```

The devotion generator already drives this pattern
(`scripts/selah/bridge.js` → `runAgent`), so reuse it rather than writing a new
client. `opencode/big-pickle` is the default model because it is outside the
OpenCode workspace spending cap; every other `opencode/*` model returns an empty
reply once that cap is hit.

**Rules that keep a job alive:**
- Work in small steps and say what you are doing between them. Two minutes of
  silent reasoning is indistinguishable from a hang and gets killed.
- Never start something that cannot finish in nine minutes. If the phase is too
  big, do the part that fits and report what is left.
- End every job with the short report at the bottom of this file. Do not dump
  file contents into the reply — the files are on disk; the reply is a summary.

---

## Context (send with every phase)

You are working on **SELAH**, an existing Bible-centred church app. Inspect
before you change anything, reuse what is there, and break nothing.

### The stack, already verified — do not re-derive it

- **Frontend:** React 18 + Vite 6, **plain JSX, no TypeScript.** Tailwind with
  oklch CSS-variable tokens (`--ink`, `--brand`, `--surface`). react-router-dom 6.
- **Edge Functions:** TypeScript on Deno, in `supabase/functions/`. Existing:
  `bible-reader`, `bible-chat`, `meditation-reminder`, `trigger-devotion`.
- **Database:** Supabase. Migrations are `supabase/migrations/YYYYMMDD[letter]_name.sql`.
- **Auth:** Supabase Auth, Google sign-in, `src/context/AuthContext.jsx`. There is
  exactly one auth system. Do not add another.
- **Tests:** `node --test` only, over **pure logic modules** under `scripts/`
  (see `scripts/selah/devotion.test.js`). There is **no frontend test runner** —
  no vitest, no jsdom, no Testing Library. Put logic you want tested in a plain
  module and test that; do not propose a React testing stack.
- **Deploy:** GitHub Actions → rsync to Hostinger. Edge Functions deploy separately.

### Existing tables

`profiles`, `user_stats`, `disciples`, `attendance_records`, `daily_devotions`,
`devotion_settings`, `goals`, `goal_participants`, `goal_contributions`,
`conquest_weeks`, `conquest_recurring`, `community_posts`, `prayer_requests`,
`device_tokens`, `notification_profiles`, `reading_positions`, `daily_backgrounds`.

`disciples` is already a **tree** (`parent_id`, `tree_owner_id`, `generation`,
`lifetime_phase`, `manual_tier`, `linked_user_id`) with a `get_disciple_tree()`
RPC and a UI at `src/pages/DiscipleTree.jsx`. `attendance_records` already records
per-session presence.

### Existing AI paths

- `bible-chat` Edge Function — study assistant, tools off, answers in seconds.
- OpenCode bridge — the nightly devotion, tools on, researches for minutes.
- **Gemini is not integrated anywhere yet.** `GEMINI_API_KEY` exists and works for
  text (`gemini-3.6-flash` verified). Image models return `limit: 0` — the free
  tier excludes them.

---

## READ THIS BEFORE DESIGNING ANYTHING

`supabase/migrations/20260915b_discipleship_signals.sql` already solves a large
part of this brief, and it made a deliberate choice that the feature request
below would quietly reverse.

It creates:

- `discipleship_signals` — a **de-identified** view: opaque 8-char `ref`s instead
  of ids, **no names, no emails, no mobile numbers, no notes**, birthdays reduced
  to a month. Plus attendance counts, generation, phase, tier, descendant counts.
- `selah_analyst` — a Postgres role holding `SELECT` on that one view and nothing
  else, so a prompt-injected agent can read only numbers it was meant to read.

Its stated reason: *"Suggestions come back keyed by ref and are matched to real
people inside the app, so nobody's name is ever sent to a model provider."* The
`notes` field is excluded specifically because it holds pastoral detail shared in
confidence.

The request below asks for "What should I do with John?" and a suggested message
beginning "Hi John!" — that sends names, and potentially notes, to Gemini.

**Do not silently pick a side.** In Phase 0, state the conflict plainly and
present the options with their costs. The likely answer is that the existing
pattern holds — the model reasons over refs and retrieved church knowledge, and
the app substitutes real names into the draft message **client-side, after the
model has returned** — but that is the church's call, not yours.

---

## Phase 0 — Discovery and design (run this first, on its own)

Do not write code. Produce:

1. **The PII decision above**, with options and a recommendation.
2. **Overlap analysis.** Does the requested `people` table duplicate `disciples`?
   Does `visits` duplicate `attendance_records`? Extend before creating.
3. **Two capability checks, run for real — do not assume:**
   - Is the `vector` extension available on this Supabase project?
     (`select * from pg_available_extensions where name = 'vector'`)
   - Does `GEMINI_API_KEY` actually have embedding quota? Call the embedding
     model once and report the HTTP status. **This matters:** the same key
     returns `limit: 0` for image models, and the whole RAG design collapses if
     embeddings are also excluded. Find this out before anything is built on it.
4. **A phase plan** where each phase is one bridge job — roughly one migration,
   or one Edge Function, or one screen.

If either capability check fails, stop and say so. Do not design around a
component you could not reach.

---

## The feature

A grounded discipleship assistant over the G12 journey — **WIN → CONSOLIDATE →
DISCIPLE → SEND** — that helps a leader answer: who needs follow-up, who is a
first/second timer, who has not been contacted in 48 hours, and what to do next.

**It assists leaders. It does not replace them.**

### Architecture

```
leader → SELAH → auth → orchestration Edge Function
                         ├─ structured facts   (plain SQL)
                         ├─ church knowledge   (pgvector similarity)
                         └─ Gemini  → grounded recommendation
```

- **SQL for facts, RAG for meaning.** Counting people, filtering dates, deciding
  first vs second timer, checking follow-up status — all plain SQL. Embeddings
  only where semantic retrieval genuinely helps. This is the main cost control.
- **The church's uploaded material is the source of truth** for church-specific
  process. When the retrieved knowledge does not cover something, the model must
  say so rather than invent procedure. Never invent doctrine.
- **RAG must not become a way around RLS.** Retrieval runs as the caller, not as
  the service role. A leader must not reach another leader's people or notes
  through the AI endpoint any more than through SQL.
- Gemini keys stay server-side. Never in the bundle.

### Data to add (only what discovery shows is missing)

- **Visits / attendance** — enough to derive first timer, second timer, returning,
  visit count, last visit. Returning people must not create duplicates.
- **Follow-ups** — assignee, type, scheduled/contacted time, method, status,
  outcome, notes. Enough to drive a 48-hour window and an overdue list.
- **Knowledge base** — `knowledge_documents` (title, category, content, version,
  status) and `knowledge_chunks` (document_id, chunk_index, content, embedding,
  metadata). Categories along the journey: WIN, CONSOLIDATE, DISCIPLE, SEND,
  FIRST_TIMER, 48_HOUR, COFFEE_CONVERSATION, NEW_BELIEVER, LEADERSHIP, GENERAL.
- **A search RPC** — `match_knowledge_chunks(query_embedding, threshold, count,
  categories)` returning content, similarity, title, category, metadata, and
  respecting the caller's authorization.

Re-embed only what changed. An unchanged document must not be re-embedded.

### Model output

Ask the model for structured JSON internally — summary, current stage,
recommended action, the reason for it, conversation points, a draft message, and
the knowledge sources it used — and render that in the existing design system.
Always distinguish **known facts**, **retrieved church guidance**, and **the
model's own suggestion**. A draft message is a draft: it is never sent without
the leader confirming, and it is never presented as official church wording
unless it came from the knowledge base.

The AI must never change someone's spiritual status, reassign a leader, diagnose
spiritual condition, or surface private notes to someone not entitled to them.

### Definition of done

A leader can record a visit, the system identifies first/second timers, a
follow-up can be assigned and its 48-hour window tracked, the outcome recorded, a
person's journey viewed, church material stored and embedded, relevant knowledge
retrieved, and a grounded recommendation produced — with RLS proven to stop
cross-leader access, no secrets in the bundle, existing SELAH features untouched,
and tests over the logic that matters.

---

## End every job with this

```
DONE      what now works, in one or two lines
FILES     created / modified
DB        migrations added (and whether they are reversible)
CHECKS    commands run and their result (tests, build)
BLOCKED   anything you could not verify, and why
NEXT      the single next phase
```

Keep it under 400 words. If you ran out of time, say exactly where you stopped.
