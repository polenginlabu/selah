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

Edge Function: `send-test-conquest-reminder`.

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
