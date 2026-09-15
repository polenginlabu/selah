# Selah

A devotional journaling and discipleship app — a journal, a gamified habit tracker, and a small-group ministry tool in one. Built as an installable PWA that runs on desktop, iOS, and Android from a single codebase.

Built and maintained end-to-end by **John Paul De Jesus (JP)**.

---

## Overview

Selah helps a believer keep a daily rhythm — read the verse of the day, journal a devotion, track a streak — and helps a leader shepherd the people under them: attendance, prayer requests, achievements, and a multi-generation discipleship tree.

Core ideas:

- **Daily devotion loop** — verse of the day, free-form journaling, streaks, and totals.
- **Gamification engine** — XP, levels, tribes, and achievements driven by real actions, not vanity counters.
- **Discipleship tree** — a live positioned canvas mapping who mentored whom, generations deep.
- **Group ministry tools** — attendance, reports, leaderboard, community feed, prayer requests.
- **Push notifications** — devotion and conquest reminders via Firebase Cloud Messaging.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 18 + React Router 6 |
| Build | Vite 6 |
| Styling | Tailwind CSS 3 (+ PostCSS, Autoprefixer) |
| Auth & data | Supabase (Postgres + Auth) |
| Push | Firebase Cloud Messaging + service worker |
| Scripture | ESV API, NLT API |
| Delivery | PWA (`manifest.json`, standalone display) |

No backend service of its own — Supabase provides auth, the relational database, and an Edge Function for reminder dispatch.

---

## Features

### Devotions
Free-form journal entries, tagged, linked to a verse and translation, and searchable. A verse of the day drives the daily prompt.

### Bible reader
In-app reader backed by the ESV and NLT APIs, so a verse can be read and journaled without leaving the app.

### Gamification
Defined entirely as data in [`src/lib/gamification.js`](src/lib/gamification.js) — adding a tier or achievement is a content change, not a code change.

- `500` XP per level.
- XP awarded for devotions, verse bonuses, conquest tasks, and evangelism.
- Five tribes mapped to level bands: **Deer** (1–10), **Sheep** (11–20), **Eagle** (21–30), **Lion** (31–40), **Ox** (41+) — each with its own color and anchor verse.
- ~35 achievements across five categories (community, leadership, spiritual, outreach, service), with daily/weekly repeatables and per-tier trophies.
- The repeatable achievements are derived into the **Conquest Week** checklist automatically.

### Discipleship tree
A custom canvas that recursively measures each subtree's width and centers children under their parent, so the layout self-arranges and stays readable as the tree grows. See [`src/pages/DiscipleTree.jsx`](src/pages/DiscipleTree.jsx).

### Leadership tools
Attendance tracking with reports, a community feed with reactions, prayer requests with supporters, and a leaderboard.

### Theming
Light and dark themes persisted per user via `ThemeContext`.

---

## Project structure

```
src/
  App.jsx              Route table; Home + SignIn eager, everything else lazy
  main.jsx             Entry point and providers
  components/
    Layout.jsx         App shell and navigation
  context/
    AuthContext.jsx    Supabase session, user state
    RewardsContext.jsx XP / level / achievement state
    ThemeContext.jsx   Persisted light-dark theme
  lib/
    supabase.js        Supabase client
    firebase.js        FCM registration, token storage, test reminder
    gamification.js    Tribes, levels, XP, achievements, conquest tasks
    date.js            Date and streak helpers
  data/                Static/seed data: books, votd, devotions, disciples, stats
  pages/               Home, BibleReader, DevotionEditor, ConquestWeek,
                       Achievements, Leaderboard, Community, DiscipleTree,
                       Attendance, Reports, SignIn
  icons.jsx            Inline SVG icon set
  tribeIcons.jsx       Tribe emblems
public/
  manifest.json            PWA manifest
  firebase-messaging-sw.js Background push handler
  .htaccess / 404.html     SPA fallback for static hosting
```

Routes are code-split with `React.lazy` + `Suspense`; only `Home` and `SignIn` ship in the initial bundle.

---

## Getting started

### Prerequisites
- Node.js 18+
- A Supabase project
- A Firebase project with Cloud Messaging enabled (optional — push degrades gracefully)
- ESV and NLT API keys (optional — needed for the Bible reader)

### Install and run

```bash
npm install
npm run dev
```

### Environment

Create a `.env` in the project root:

```bash
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_ESV_API_TOKEN=<esv api token>
VITE_NLT_API_KEY=<nlt api key>
```

`.env` is gitignored. Only the Supabase **anon** key belongs here — it is safe for the browser as long as Row Level Security is enabled on every table.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |

---

## Data model

Supabase tables used by the client:

| Table | Purpose |
| --- | --- |
| `profiles` | User profile data |
| `user_stats` | XP, level, streak, totals |
| `daily_devotions` | Generated daily SELAH devotion per user per day |
| `devotions` | Journal entries with verse and translation |
| `conquest_weeks` | Weekly conquest checklist state |
| `conquest_recurring` | Recurring conquest task config |
| `attendance_records` | Small-group attendance |
| `disciples` | Discipleship tree edges |
| `community_posts` | Community feed |
| `community_post_reactions` | Reactions on posts |
| `prayer_requests` | Prayer requests |
| `prayer_supporters` | Who is praying for what |
| `device_tokens` | FCM tokens per user |
| `notification_profiles` | Per-user timezone for reminder scheduling |

Edge Function: `send-test-conquest-reminder`, `daily-devotion`.

---

## Daily devotional engine

On the first open of a new day, the Home screen asks the `daily-devotion` Edge Function to write a SELAH devotion for that day — a topic, a real Scripture passage (fetched and quoted verbatim from `bible-api.com`), a short teaching, paraphrased insights from a curated library of Rick Warren / Vlad Savchuk / Oriel Ballano summaries, reflection questions, an application, a prayer, and a "be still" prompt.

Two design rules keep it safe and useful:

- **Random + intentional.** The topic is chosen at random from ~21 topics, but topics covered in the last 7 days are excluded and under-covered topics carry more weight, so the list is walked evenly instead of clustering.
- **Bible first, teachers second.** The Bible is the authority; the teacher notes are labeled summaries and are never quoted verbatim or presented as Scripture. The verse text the model is allowed to quote is fetched and verified, never left to model memory.

The generated devotion is stored per user per day in `daily_devotions` and served straight from the DB on every later visit. Deleting today's row regenerates it.

### Deploying

```bash
supabase db push                        # applies supabase/migrations/20260914_daily_devotions.sql
supabase functions deploy daily-devotion
```

The function reuses the study assistant's OpenAI-compatible endpoint and reads `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and optionally `DEVOTION_MODEL` (defaults to `CHAT_MODEL`, then `gpt-4o-mini`) — the first two are already set if the study assistant is live. Re-deploy whenever `prompt.ts` or `topics.ts` changes. The topic picker is covered by `supabase/functions/daily-devotion/topics.test.ts`.

**Model choice on OpenCode Zen.** Free "stealth" models like `big-pickle` only work inside OpenCode itself (their free tier requires an OpenCode session ID); a bare API call from an Edge Function is rejected with HTTP 400 `MissingSessionID`. Use a paid Zen model id instead — e.g. `deepseek-v4-flash` (chat) and `deepseek-v4-pro` (devotion), both on `https://opencode.ai/zen/v1` with the key from `opencode.ai/auth`.

### Generating the devotion locally (the Big Pickle path)

Because `big-pickle` free tier only runs inside an OpenCode session, it can't be the Edge Function's model — but a local script can open that session for you. `scripts/generate-daily-devotion.js` reuses the exact same topic picker and prompt (`topics.ts` / `prompt.ts`, loaded with Node's TS type-stripping), fetches the anchor verse, and then generates the devotion with `opencode run -m opencode/big-pickle`. It writes the finished row straight into `daily_devotions` with the service-role key, so the app serves it like any other.

```bash
cp .env.local.example .env.local   # then fill in the three values
npm run devotion:generate          # picks topic, generates, saves today's row
npm run devotion:dry-run           # same, but prints instead of saving (needs no credentials)
```

`.env.local` is gitignored; the service-role key comes from Supabase → Project Settings → API. Scope is one user by email via `auth.admin.listUsers`. Tests and `--dry-run` run the whole pipeline without writing (today: 6/6 topic tests pass).

Trade-offs: a machine has to be running with opencode installed when the devotion is generated, and Big Pickle's free tier records its sessions, so it's fitting for a personal devotional — use the paid Zen models for anything confidential. If the Edge Functions are already deployed with `deepseek-v4-pro`, both paths can coexist; the first row written wins per `(user_id, date)`.

Automation: a macOS LaunchAgent can run it daily, e.g. with `StartCalendarInterval Hour:6 Minute:50` and a zsh program of `cd "/path/to/selah-app" && node --experimental-strip-types scripts/generate-daily-devotion.js`. The script is idempotent, so an extra invocation is harmless.

---

## Notifications

`enableNotifications(userId)` requests permission, registers `/firebase-messaging-sw.js`, retrieves an FCM token with the VAPID key, then upserts the token and the user's IANA timezone so reminders fire at the right local hour. Everything is guarded by `isSupported()` and feature checks, so unsupported browsers return `'unsupported'` instead of throwing.

---

## Deploying

```bash
npm run build
```

Deploy `dist/` to any static host. The bundled `.htaccess` and `404.html` provide SPA history fallback on Apache and GitHub-Pages-style hosts. Serve over HTTPS — the service worker and push notifications require a secure context.

---

## Notes

- Build output uses stable `assets/app.js` and `assets/app.css` filenames (see `vite.config.js`) to fit a fixed-path hosting setup; lazy chunks remain content-hashed.
- Firebase web config values in `src/lib/firebase.js` are public by design; access control lives in Supabase RLS and FCM server-side rules.

---

## License

Private project. All rights reserved.
