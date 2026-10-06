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
| Scripture | API.Bible (NIV UK, MSG, AMP), bible-api.com, optional ESV/NLT |
| Delivery | PWA (`manifest.json`, standalone display) |

No backend service of its own — Supabase provides auth, the relational database, and an Edge Function for reminder dispatch.

---

## Features

### Devotions
Free-form journal entries, tagged, linked to a verse and translation, and searchable. A verse of the day drives the daily prompt.

### Bible reader
Mobile-first reader with a book/chapter picker, translation picker, full-Bible search
in NIV UK/MSG/AMP, adjustable text size and font, paragraph/verse layouts, and
copy/share/journal actions. The reading position and appearance are saved locally.
MSG verse ranges are preserved rather than splitting or duplicating their text.

API.Bible is accessed through the authenticated `bible-reader` Supabase Edge
Function. Its API key never enters the Vite bundle. Set **API_BIBLE_KEY** under
Supabase → Edge Functions → Secrets, then deploy:

```bash
supabase functions deploy bible-reader --no-verify-jwt
```

The function validates the caller with `auth.getUser()` itself (including newer
Supabase signing keys). Only the three configured translation IDs and valid
chapter/search requests are proxied. Availability is checked against the live
subscription catalogue; provider errors are displayed without switching versions
silently. New readers start in NIV Anglicised; existing saved versions are retained.
WEB/KJV/BBE remain available without an API.Bible subscription.

Publisher copyright is displayed below each chapter and API.Bible's FUMS view
token is reported through its browser tracker when Scripture is displayed. Licensed
chapters are not persisted to localStorage or the service worker cache. Run parser
and canonical-book validation tests with `npm run bible:test`.

Selecting a verse and tapping **Share** opens a shareable Scripture card drawn
over the day's AI-generated background — see
[Verse sharing with daily backgrounds](#verse-sharing-with-daily-backgrounds).

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
- An API.Bible subscription/key for NIV UK, MSG and AMP (server-side secret)
- ESV and NLT API keys (optional legacy translations)

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
# Optional: verse "Explain" via Zackion AI; unset hides it.
VITE_ZACKION_CHAT_URL=https://www.zackion-ai.com/api/chat/2c02a09f-82fa-4044-8b61-6b67b2bd44ae
```

`.env` is gitignored. Only the Supabase **anon** key belongs here — it is safe for the browser as long as Row Level Security is enabled on every table.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run devotion:generate` | Generate and save today's devotion |
| `npm run devotion:dry-run` | Same, printed instead of saved |
| `npm run background:fetch` | Fetch, upload and record today's stock-photo background |
| `npm run background:fetch:dry-run` | Same, but uploads and writes nothing |
| `npm run background:generate` | Generate a background with an image model instead (needs a billed Gemini key) |
| `npm run background:dry-run` | Same, but uploads and writes nothing |
| `npm run devotion:test` | Devotion validator and background logic tests |
| `npm run background:test` | Background theme, prompt, image-guard and stock-photo selection tests |
| `npm run card:test` | Verse card typesetting tests |
| `npm run bible:test` | Bible parser and canonical-book tests |

---

## Data model

Supabase tables used by the client:

| Table | Purpose |
| --- | --- |
| `profiles` | User profile data |
| `user_stats` | XP, level, streak, totals |
| `daily_devotions` | Generated daily SELAH devotion per user per day |
| `daily_backgrounds` | One background image per date, with stock-photo attribution (metadata only; the image is in Firebase Storage) |
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

## Verse sharing with daily backgrounds

Select a verse in the Bible reader, tap **Share**, and SELAH renders a 1080×1920
Scripture card: the verse, its reference, the translation, the SELAH wordmark,
and the day's background image.

Every night, right after the devotion is written, the *Daily devotion* workflow
fetches that day's background: a **freely-licensed minimalist atmospheric
landscape illustration** (layered hills, haze, calm sea, soft light) whose
subject matches the devotion. No image is generated and no browser automation is
involved — the image comes from an official image search API with its licence
metadata attached. Images already stored, including earlier stock photographs,
are left as they are.

The governing rule of this feature:

> **The background is a picture. SELAH generates the Scripture card.**

Every glyph on the card is drawn by the app from the Bible API's own text.
Photos with people, faces, lettering, logos or other faiths' religious imagery
are rejected, so nothing in the background competes with the verse.

### How it fits together

```
Nightly Action, after the devotion step (or by hand)
  └─ scripts/fetch-daily-background.js
       ├─ read daily_devotions        title, verse, theme for the date
       ├─ buildImageQueries()         2-4 nature keywords, most specific first
       ├─ Pixabay (PIXABAY_API_KEY) → Openverse (no key)   licence-filtered search
       ├─ rankCandidates()            content filter, 30-day no-repeat, date-seeded pick
       ├─ toBackgroundWebp()          sharp → 1080×1920 WebP, q82
       ├─ uploadBackground()          Firebase Storage (public, immutable)
       └─ upsert daily_backgrounds    Supabase (metadata + attribution)

Browser
  listBackgrounds()  →  image_url  →  <canvas>  →  navigator.share()
```

One image per day, shared by every user. The background is chosen by **date**,
never by the verse — so everyone sharing a verse on 19 September gets the same
photo.

**Matching the devotion.** Keywords come from the day's `daily_devotions` row.
Nature words in the title and key verse are used first ("beside still waters" →
`lake`, "green pastures" → `meadow`), filled out with a landscape phrase for the
devotion's theme (`rest` → *misty forest landscape*), because abstract words like
"grace" return images of people. Each query is tried first with the style word
`minimalist` and then without it, because keyword search ANDs its terms. If a
precise query finds nothing usable the script widens to the theme phrase, then
to a generic misty mountain landscape. With no
devotion for the date it uses the date's rotating theme. Logic and tests:
`scripts/selah/stockBackground.js`.

**Licences.** Only photos that may be used commercially without permission or a
credit on the shared image are accepted: the **Pixabay Content License**,
**CC0** and the **Public Domain Mark**. CC-BY and other attribution-required
licences are refused, because the shared card carries no credit. Pixabay is
queried with `image_type=illustration`, `orientation=vertical`, `safesearch=true`
and a 1080×1920 minimum original size; its `largeImageURL` (1280px on the long
side) is downloaded, upscaled to the card and served from Firebase, never
hotlinked. Openverse is queried with `license=cc0,pdm`, `category=illustration`,
`mature=false`. The CC0/PDM illustration pool on Openverse is small, so set
`PIXABAY_API_KEY` for reliable daily results.

**Attribution.** Each row stores `attribution` (provider, source id and page,
photographer, licence and licence URL, search query, fetch time); the same
fields are written to the Firebase object's metadata. The verse card shows
*Photo: &lt;photographer&gt; · &lt;provider&gt;*, linked to the source page,
under the background picker when a stock photo is selected. A database
trigger keeps `attribution` only on rows whose `model` starts with `stock:`,
so replacing a stock day with a generated or uploaded image (`--force` or the
admin panel) also removes the old credit.

**Choosing among results.** Results are filtered, sorted by source id and
picked by a date seed, so a rerun for the same date picks the same photo.
Photos used by any background within 30 days are skipped.

**Storage layout.** `selah/backgrounds/YYYY/MM/DD.webp`, e.g.
`selah/backgrounds/2026/09/19.webp`.

**Why Firebase and not Supabase Storage.** Supabase is the application database
and its storage quota is kept for user content. These images are bulk,
immutable and CDN-served. Only the metadata row lives in Supabase — the browser
reads `image_url` and puts it in an `<img>`. There is no Firebase SDK on the
client path for this feature and no credential of any kind.

**Fallback.** A missing background is an ordinary outcome, not an error. The
card falls back to yesterday's image, and failing that to a gradient drawn from
SELAH's own palette. The Bible reader never breaks over a missing picture, and
the card is always shareable.

### Setup

**1. Database**

```bash
supabase db push    # applies 20260919b_daily_backgrounds.sql and 20261005_daily_background_attribution.sql
```

The fetch script stops before downloading anything if the `attribution` column
is missing.

**2. Firebase Storage**

Enable Storage in the Firebase console if you never have. Then, once the
secrets in step 3 are in `.env.local`:

```bash
npm run firebase:check    # confirm the bucket is reachable, change nothing
npm run firebase:setup    # apply deploy/firebase/cors.json to the bucket
```

This deliberately needs **no `gcloud` and no Firebase CLI** — it authenticates
with the same service account the generator already uses, through the
`@google-cloud/storage` client that `firebase-admin` bundles. If `npm ci` has
run, it works.

Security rules are the one thing it cannot do: rules are a Firebase concept
with no GCS API behind them. Paste `deploy/firebase/storage.rules` into the
Firebase console under **Storage → Rules** and hit Publish.

The CORS step is **not optional**. The card is drawn into a `<canvas>` and
exported with `toBlob()`; a cross-origin image drawn without CORS taints that
canvas and `toBlob()` throws at the moment the user taps Share. The card
therefore loads the background with `crossOrigin="anonymous"`, which only
succeeds if the bucket sends those headers. Skip this and nothing errors
visibly — backgrounds simply never appear and every card shows the gradient.

Verify it:

```bash
npm run firebase:check    # prints the bucket's current CORS configuration
```

**3. Secrets**

| Secret | Where | What it is |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | GitHub Actions + `.env.local` | Service account JSON (raw or base64) with **Storage Object Admin**. Firebase console → Project settings → Service accounts → Generate new private key. |
| `FIREBASE_STORAGE_BUCKET` | GitHub Actions + `.env.local` | e.g. `devotional-app-c2633.firebasestorage.app` |
| `PIXABAY_API_KEY` | optional, GitHub Actions + `.env.local` | Free key from pixabay.com/api/docs. When set, Pixabay is searched first; without it (or if Pixabay fails) the script uses Openverse, which needs no key. |
| `BACKGROUND_MODEL` | optional | Only for `generate-daily-background.js`. Defaults to `google/gemini-3.1-flash-image` (Nano Banana 2). |

`SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_URL` are already configured for
the devotion job and are reused.

The service account can be supplied three ways, and the right one differs by
environment:

| Where | Form | Why |
| --- | --- | --- |
| Local `.env.local` | **absolute path** to the `.json` | No encoding step to get wrong, and the key stays outside the repo |
| GitHub Actions | **base64** of the file | A GitHub secret and a `.env` parser both mangle the newlines in the private key |
| Anywhere | raw JSON | Works, but only through a real env var — a multi-line blob will not survive `.env` line parsing |

```bash
base64 -i firebase-sa.json | pbcopy    # for the GitHub secret
```

On macOS `-i` is required; `base64 file` reports `invalid argument`. Watch for
a glob matching two downloaded keys — `base64 -i a.json b.json` consumes the
`-i` and fails on the second file.

The service account can read and write every bucket in the project. It lives in
the Action and on developer machines only; it must never reach the browser.

### Running it

```bash
npm run background:fetch:dry-run                              # search + download + process, upload nothing
node scripts/fetch-daily-background.js --dry-run --theme stillness --out /tmp/bg.webp   # save it to look at
npm run background:fetch                                      # the real thing
node scripts/fetch-daily-background.js --date 2026-09-19 --force   # replace one day
```

A dry run reads the devotion when Supabase credentials are present and works
without any credentials at all (searching by `--theme` or the date's theme).

**Manual trigger in CI.** Actions → *Daily devotion* → Run workflow. Inputs:
`date`, `model` (devotion only) and `force`, which replaces an existing
devotion **and** background.

**Failures never fail the job.** No usable photo, a provider outage, a missing
secret or a Firebase error prints a `::warning::` annotation and exits 0; the
step is also `continue-on-error`. Only a bad argument (e.g. an invalid
`--date`) exits 1. The app keeps showing the previous background.

### Other ways to supply a background

`scripts/upload-background.js` uploads images you already have, and
`scripts/generate-daily-background.js` generates one with an image model
(Nano Banana 2 through the OpenCode bridge; needs a billing-enabled Gemini key,
since Gemini image generation has no free tier). Both do the same resize,
upload and row write as the fetch script, without attribution. **The app cannot
tell the difference**: it reads the `daily_backgrounds` row either way.

```bash
npm run background:upload -- --file sunrise.jpg                    # today
npm run background:upload -- --file sunrise.jpg --date 2026-09-21  # one date
npm run background:upload -- --file ./backgrounds/ --date 2026-09-21   # a folder
npm run background:upload -- --file x.jpg --dry-run                # process only
```

Passing a **directory** fills consecutive dates from `--date`, in filename
order — the quickest way to cover a fortnight in one command. Existing dates
are skipped unless `--force` is passed, so re-running is safe.

Any size or aspect ratio is accepted; `cover` crops to 9:16 from the centre.
Pick calm images with uncluttered middles — the verse is set over that area.
Rows are recorded with `model: 'manual-upload'` so hand-picked and generated
backgrounds stay distinguishable later.

### Reruns

The fetch script is idempotent by date: if a `daily_backgrounds` row exists it
stops before contacting any provider, unless `--force`. A rerun with `--force`
picks a different photo, since the replaced one now counts as recently used.

Firebase is written before Supabase, deliberately. The row is the app's source
of truth, so it must never point at an image that is not there. If a run dies
between the two, the next run finds no row and fetches again, overwriting the
orphaned object.

### Troubleshooting

**"No freely-licensed photo matched any query."** — every query returned
nothing that passed the licence and content filters. Rerun with `--theme` to
try a different phrase, or upload one by hand.

**"pixabay returned HTTP 400/401 … — skipping pixabay"** — `PIXABAY_API_KEY` is
wrong or revoked. **"pixabay returned HTTP 429 (rate limited)"** — the key's
request rate limit was hit. Either way the run continues with Openverse.

**"Could not read recent backgrounds … attribution"** — the attribution
migration has not been pushed. See step 1.

**"The returned bytes are not a PNG, JPEG, WebP or GIF image."** — the download
was not an image. Formats are checked by magic bytes, not by a claimed MIME
type; the script tries the next of the top three results.

**"Firebase upload failed"** — check the service account has *Storage Object
Admin* and that `FIREBASE_STORAGE_BUCKET` is the bucket **host**
(`…firebasestorage.app`), not the project id. No metadata row is written when
an upload fails, so the app keeps showing the previous background rather than a
broken link.

**Backgrounds exist in Firebase but cards show the gradient** — the bucket CORS
rule is missing. See step 2 above.

**Nothing at all happens on the card** — open the console. `getLatestBackground`
warns rather than throws; a missing table (migration not pushed) or an RLS
denial both surface there.

### Future: the background gallery

`daily_backgrounds` keeps every row rather than only today's, and
`listBackgrounds({ limit, before })` in `src/data/dailyBackgrounds.js` already
returns them newest-first. A "choose a previous background" picker is a UI
change, not a migration.

---

## Agent bridge status (admin)

The Admin console has an **Agent bridge** panel that reports whether the
OpenCode stack behind the nightly devotion is alive, lists the models it can
reach, and sets the bridge's default model.

Bridge health and OpenCode health are shown separately on purpose: a healthy
bridge in front of a dead OpenCode is the state that produces silent empty
replies rather than errors, and it is worth being able to see that.

### The browser never talks to the bridge

```
browser → bridge-admin Edge Function → (token) → reverse proxy → 127.0.0.1:4098
           └ is_admin() in the database    └ server-side secret
```

The bridge has no user accounts and runs an agent with filesystem access — its
own source says the only thing protecting it is that it listens on loopback.
Pointing the browser at it directly would mean publishing that port, and a token
shipped in a Vite bundle is public the moment it deploys. So the token lives in
the Edge Function, which checks `is_admin()` in the database first and forwards
only three named actions. It is a whitelist, never an arbitrary path — otherwise
it would be a general-purpose proxy into the private network.

### Setup

**0. Put the code on the server.** The deploy workflow rsyncs `dist/` only, so
`backend/` is never on the host. Clone the repo **outside the web root** —
anything under `public_html` is downloadable, including `.env` files:

```bash
cd ~
git clone https://github.com/polenginlabu/selah.git selah-bridge
cd ~/selah-bridge
npm run bridge:install          # installs the bridge's deps only
```

Needs Node on the host — `node -v` before anything else. `opencode` is a
self-contained binary and runs anywhere; the bridge is a Node app and is not.

**1. Run it, the same two commands as locally:**

```bash
opencode serve --port 4097 --hostname 127.0.0.1     # terminal 1
npm run bridge                                      # terminal 2, from the repo root
```

`npm run bridge` is just `npm start --prefix backend/bridge/opencode-bridge`
with the workspace root pinned to the repo, so there is no directory to
remember and the agent is not told its world is the bridge folder.

To survive logout, background it — though note that shared hosting reaps
long-running processes regardless:

```bash
nohup npm run bridge > ~/bridge.log 2>&1 &
```

**2. Give it a token** if anything off-box will reach it. Optional and off by
default, so a laptop and the GitHub Action are unaffected:

```bash
export BRIDGE_TOKEN="$(openssl rand -hex 32)"
export OPENCODE_SERVER_PASSWORD="$(openssl rand -hex 32)"
npm run bridge
```

The bridge prints which auth mode it is in on startup. Keep
`BRIDGE_HOST=127.0.0.1` — the reverse proxy below is the only way in.

**2. Expose it through `bridge.php`, not directly.** The bridge stays bound to
127.0.0.1; `public/bridge.php` is the only way in. It ships with the normal
deploy, so there is nothing to place by hand.

An Apache `[P]` proxy rule would be tidier, but this plan refuses it — the rule
matches, the proxy is attempted, and Hostinger answers **503** from its own
error page (`platform: hostinger`, and no `x-hcdn-upstream-rt`). PHP runs on the
web tier and can open a loopback socket, so it does the job in ten lines.

`bridge.php` forwards only three exact paths, hard-codes the origin, and passes
the caller's bearer token through for the bridge to check — so an anonymous
caller gets a 401 and nothing else. Without that whitelist it would be an SSRF
into anything else listening on the box.

Verify once deployed:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://your-domain/bridge.php/api/health
```

| Code | Meaning |
| --- | --- |
| **401** | Working — reached the bridge, correctly refused without a token |
| **502** | `bridge.php` is live but the bridge is not running |
| **404** | The SPA fallback swallowed it, or PATH_INFO is unsupported — try `?p=/api/health` |
| **500** | PHP cURL missing on the host |

**3. Give the Edge Function the secrets and deploy it:**

```bash
supabase secrets set BRIDGE_URL=https://your-domain/bridge.php
supabase secrets set BRIDGE_TOKEN=the-same-value-as-step-1
supabase functions deploy bridge-admin
```

### Keeping it running

`opencode serve` and the bridge both die when the SSH session closes, and
CloudLinux reaps long-running processes on shared accounts anyway. Cron is the
supervisor here — not systemd (no root) and not supervisord, which is itself a
long-running process that something would have to restart.

`deploy/hostinger/keepalive.sh` runs every few minutes, asks each process over
HTTP whether it is answering, and starts whichever is not. It checks by asking
rather than by `pgrep`, because a wedged process still has a pid; only a
refused connection counts as down. A `401` from the token-protected bridge is a
healthy answer and is treated as up.

**1. Put the token where cron can read it** — outside the repo, so it is never
committed:

```bash
printf 'BRIDGE_TOKEN=%s\n' "$BRIDGE_TOKEN" > ~/.selah-bridge.env
chmod 600 ~/.selah-bridge.env
```

**2. Add the cron entry** (`crontab -e`, or hPanel -> Cron Jobs):

```cron
*/5 * * * * /bin/sh $HOME/selah-bridge/deploy/hostinger/keepalive.sh
```

Five minutes is a reasonable floor: a restart takes seconds, so the worst case
is a few minutes of downtime, and the check costs two loopback requests when
everything is healthy.

**3. Watch it work:**

```bash
tail -f ~/keepalive.log     # only writes when it has to restart something
tail -f ~/bridge.log
```

The script takes a lock (`mkdir`, which is atomic) so two overlapping runs
cannot both decide a process is down and start two copies; a lock older than
15 minutes is treated as stale and cleared. It trims its own logs at 2000
lines, since shared accounts have a disk quota.

Cron runs with a near-empty `PATH`, which is why the script sets one — without
it neither `node` nor `opencode` would be found, and the failure would be a
silent "command not found" in a log nobody reads.


### Troubleshooting

| Panel says | Means |
| --- | --- |
| Unreachable | `BRIDGE_URL` is wrong, the proxy is not active, or the box is down |
| Returned a web page rather than JSON | The SPA fallback caught it — check the `bridge.php` exemption in .htaccess |
| Rejected the token | `BRIDGE_TOKEN` in Supabase does not match the bridge's |
| Bridge up, OpenCode down | `opencode serve` is not running, or died. Restart it |
| Admins only | The signed-in account is not an admin according to `is_admin()` |

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
