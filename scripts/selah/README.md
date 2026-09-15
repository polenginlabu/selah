# SELAH daily devotional — generator

One devotion per day for the whole app. The SELAH agent brief runs through the
OpenCode bridge so the agent can genuinely research Scripture and the trusted
teachers it cites, then one `daily_devotions` row is written for the date.

Every user reads that same row. The browser never talks to the bridge, so
nothing user-facing depends on it being reachable.

## Files

| File | Role |
| --- | --- |
| `agent-prompt.js` | The SELAH brief, verbatim. Edit the devotional's character here. |
| `prompt.js` | Adds today's date, recent topic history, and the JSON contract. |
| `bridge.js` | Talks to the bridge. Tools **on** — the research is the point. |
| `devotion.js` | Parses and validates. The source-leak guard lives here. |
| `cron.sh` | Cron entry point: locking, dependency startup, logging. |
| `../generate-daily-devotion.js` | CLI. |

## Running it by hand

```sh
npm run devotion:dry-run     # generate and print, write nothing
npm run devotion:generate    # generate and save today's row
npm run devotion:test        # unit tests, no network needed

node scripts/generate-daily-devotion.js --date 2026-09-20
node scripts/generate-daily-devotion.js --force          # replace today's
node scripts/generate-daily-devotion.js --model opencode/claude-sonnet-4-6
```

Takes 2–4 minutes: the agent runs several web searches and fetches before it
writes. Rejected output is kept in `.selah-debug/` so a bad run can be
diagnosed without paying for another.

## Scheduling: GitHub Actions

The nightly run lives in [`.github/workflows/daily-devotion.yml`](../../.github/workflows/daily-devotion.yml).
`opencode serve` and the bridge are started inside the runner, used, and thrown
away with it — nothing persistent runs on any server, no port is exposed, and
there is no process to supervise.

### Secrets to add

Settings > Secrets and variables > Actions:

| Secret | Where it comes from |
| --- | --- |
| `OPENCODE_AUTH_JSON` | contents of `~/.local/share/opencode/auth.json` on a machine where `opencode auth login` has been run |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API > `service_role` |
| `VITE_SUPABASE_URL` | already set for the deploy workflow; reused here |

```sh
# prints the value to paste into OPENCODE_AUTH_JSON
cat ~/.local/share/opencode/auth.json
```

Both secrets are live credentials: the auth file holds an API key, and the
service-role key bypasses every RLS policy.

### When it runs

`0 19 * * *` UTC — 03:00 Asia/Manila the next day. GitHub's scheduler is
best-effort and can be delayed by an hour or more at busy times, which does not
matter here: the devotion is dated in `Asia/Manila` rather than from the clock
at run time, and generation is idempotent by date, so a late run still produces
the right day's devotion and a repeat produces nothing.

### Running it by hand

Actions > Daily devotion > Run workflow. Optional inputs: `date`, `model`, and
`force` to replace a day that already has one.

### When a run fails

The workflow uploads an artifact (`selah-debug-<run id>`) containing the agent
output that failed validation plus the `opencode` and bridge logs, so a bad
night is diagnosable without paying for another research run.

## Two things that will bite

**The OpenCode spending cap.** `opencode/*` models are billed against a monthly
workspace limit. Once it is reached they return an *empty reply*, not an error.
`big-pickle` is the default because it is not billed against that cap. If
devotions stop appearing, check
`https://opencode.ai/workspace/<your-workspace>/billing` first.

**Research sources must stay internal, and the prompt alone will not keep
them there.** The brief researches trusted teachers to deepen the writing but
forbids naming them: the reader should meet Scripture, not a reading list. A
model that has just read three sermons still reaches for "Rick Warren often
says…" by reflex, so `findLeakedSources` in `devotion.js` checks every
reader-facing field and rejects the devotional if a name, surname or ministry
appears. A rejection triggers a fresh run, since no amount of reformatting
removes a name the agent chose to write.
