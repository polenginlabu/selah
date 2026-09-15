# Running the SELAH agent stack on a server

Written for: whoever administers the server.

> **You probably do not need this.**
>
> The nightly devotion runs in GitHub Actions
> ([`.github/workflows/daily-devotion.yml`](../.github/workflows/daily-devotion.yml)),
> which starts `opencode serve` and the bridge inside the runner and throws
> them away with it. Nothing persistent is required on Hostinger, which only
> serves the built site. See [`scripts/selah/README.md`](../scripts/selah/README.md).
>
> This guide is for the separate case of wanting the bridge running on a server
> of your own — for the `build.html` chat UI, or to drive the agent from that
> machine. If that is not you, skip it.

The generator needs two long-running processes on the same machine as the cron
job — `opencode serve` (the agent) and the bridge (HTTP in front of it). The
app itself never talks to either; it only reads the row they produce.

## 0. Check your plan first

**This needs a VPS.** Hostinger *shared* / *Premium* / *Business* web hosting
cannot run this: no persistent background processes, no arbitrary binaries, and
the ~150 MB OpenCode binary plus its growing database will not fit the model
those plans are built for. If `systemctl` and `ssh` are unavailable to you, you
are on shared hosting.

On a VPS, check you have room before installing — OpenCode is a ~150 MB binary
and its local database grew past 100 MB in a single day of heavy use here:

```sh
df -h /
free -m          # 1 GB RAM is tight; 2 GB is comfortable
node --version   # 20 or newer
```

## 1. Install OpenCode

```sh
curl -fsSL https://opencode.ai/install | bash
```

It installs to `~/.opencode/bin/opencode`. Confirm and note the path — the
systemd unit needs the absolute one:

```sh
which opencode || ls ~/.opencode/bin/opencode
opencode --version
```

Alternatives if you prefer a package manager: `npm install -g opencode-ai`, or
`sudo pacman -S opencode` on Arch.

## 2. Authenticate

This is the step that catches people out on a headless box: the agent cannot
call any model without credentials, and a missing credential shows up as an
*empty reply*, not an error.

```sh
opencode auth login
```

If that wants a browser you cannot open over SSH, copy the credentials from a
machine that is already logged in. They live in one file:

```sh
# on your Mac
scp ~/.local/share/opencode/auth.json user@your-server:~/.local/share/opencode/auth.json

# on the server
chmod 600 ~/.local/share/opencode/auth.json
opencode auth list
```

Create `~/.local/share/opencode/` first if it does not exist. Treat that file
like a password: it holds a live API key.

Copy it as **the same user the service will run as**. Credentials are found via
`$HOME`, which is why the systemd unit sets `Environment=HOME=...` explicitly —
systemd does not set it the way a login shell does.

## 3. Install the services

These are what keep the bridge running continuously: systemd starts both on
boot, restarts them if they die, and a timer catches the case where they are
alive but not working.

```sh
sudo mkdir -p /var/log/selah && sudo chown selah:selah /var/log/selah

sudo cp deploy/opencode.service     /etc/systemd/system/
sudo cp deploy/selah-bridge.service /etc/systemd/system/
```

Edit both: `User`, `Group`, the `ExecStart` path, `WorkingDirectory`, and
`OPENCODE_ROOT_PATH`. Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now opencode selah-bridge
sudo systemctl status opencode selah-bridge
```

Verify. `"success":true` means both are healthy — the bridge reports its own
health *and* OpenCode's, and a healthy bridge in front of a dead OpenCode is
exactly the state that produces silent empty replies:

```sh
curl -s http://127.0.0.1:4098/api/health
```

Both restart on failure and start on boot, so a reboot does not cost a
devotion.

### Keeping it up

`Restart=always` covers a process that crashes or is OOM-killed. Two things it
does not cover, so they are handled separately:

**A crash loop.** systemd gives up after 5 restarts in 10 seconds by default
and leaves the unit dead until someone notices. `StartLimitIntervalSec=0` in
both units disables that, so they keep retrying.

**Alive but wedged.** The failure that actually bites is the bridge staying up
and answering while OpenCode behind it is dead — every prompt then returns an
*empty reply* rather than an error, and systemd sees a healthy process. The
watchdog checks the bridge's composite health (which reports OpenCode's state
too) every 5 minutes and restarts the pair when it goes bad:

```sh
sudo cp deploy/selah-health-check.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/selah-health-check.sh
sudo cp deploy/selah-health.service deploy/selah-health.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now selah-health.timer

systemctl list-timers selah-health.timer     # confirm it is scheduled
```

**Logs filling the disk.** The services append on every restart and the nightly
run adds a few hundred lines a day. On a small VPS that is a slow leak, and a
full disk takes the whole app down:

```sh
sudo cp deploy/logrotate-selah /etc/logrotate.d/selah
sudo logrotate --debug /etc/logrotate.d/selah    # dry run, changes nothing
```

### If you would rather use PM2

Hostinger's own guides usually reach for PM2, and it works — but it only
manages the bridge. `opencode serve` still needs supervising, logs still need
rotating, and PM2 needs `pm2 startup` to survive a reboot, which is systemd
underneath anyway. If PM2 is already running other apps on this box:

```sh
cd /var/www/selah-app/backend/bridge/opencode-bridge
BRIDGE_HOST=127.0.0.1 OPENCODE_ROOT_PATH=/var/www/selah-app \
  pm2 start server.js --name selah-bridge --max-memory-restart 512M
pm2 start "$(which opencode)" --name opencode -- serve --port 4097 --hostname 127.0.0.1
pm2 save
pm2 startup        # prints a command to run as root; run it
```

Use one or the other, never both — two supervisors fighting over port 4098
produces `EADDRINUSE` and a restart loop.

## 4. Configure the app

```sh
cd /var/www/selah-app
cp .env.local.example .env.local
nano .env.local        # SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
chmod 600 .env.local
npm ci
```

Then prove the whole chain before trusting it to cron:

```sh
npm run devotion:dry-run
```

Expect 2–4 minutes and log lines showing `websearch` and `webfetch` — that is
the research actually happening. It writes nothing.

## 5. Schedule it

```sh
crontab -e
```

```cron
MAILTO=you@example.com
0 3 * * * /var/www/selah-app/scripts/selah/cron.sh >> /var/log/selah/devotion.log 2>&1
```

Cron uses the **server's** timezone, and the generator dates the devotion in
`Asia/Manila`. Check what the box thinks the time is:

```sh
timedatectl
sudo timedatectl set-timezone Asia/Manila     # simplest
```

If you cannot change it, convert instead: 03:00 Manila is `0 19 * * *` on a UTC
server.

`MAILTO` only mails you on failure — the script exits `0` when it wrote the
devotion *or* when one already existed.

## Security

**Never expose port 4098.** The bridge has no authentication and runs an agent
that can read and write files as its user. Anyone who reaches that port can run
commands on your server. It binds to `127.0.0.1` by default for that reason;
`BRIDGE_HOST=0.0.0.0` is for a firewalled network, not a public VPS.

Confirm nothing is listening publicly, and that the ports are closed from
outside:

```sh
ss -tlnp | grep -E '4097|4098'      # both should show 127.0.0.1, not 0.0.0.0
sudo ufw status
```

`opencode serve` also warns that `OPENCODE_SERVER_PASSWORD` is unset. On
loopback that is acceptable; if you ever bind it wider, set it.

`.env.local` holds the Supabase **service-role** key, which bypasses every RLS
policy. `chmod 600`, and never let it into the web root or the built bundle.

## When it stops working

```sh
tail -50 /var/log/selah/devotion.log     # the nightly runs
journalctl -u selah-bridge -n 50         # the bridge
journalctl -u opencode -n 50             # the agent
ls -la /var/www/selah-app/.selah-debug/  # output that failed validation
```

**Devotions silently stop appearing.** Almost always the OpenCode monthly
spending limit. Past the cap, models return an empty reply rather than an
error. Check `https://opencode.ai/workspace/<your-workspace>/billing`. The
default model (`opencode/big-pickle`) is not billed against that cap, which is
why it is the default.

**"bridge/opencode not healthy".** One of the services is down:
`sudo systemctl restart opencode selah-bridge`. Check whether the watchdog has
been doing this on its own — repeated restarts in `/var/log/selah/health.log`
mean something is wrong underneath, usually the billing cap above.

**`EADDRINUSE` on port 4098.** Something already holds it — usually a stale
bridge started by hand, or PM2 and systemd both managing it. Find and stop it:

```sh
sudo ss -tlnp | grep 4098
sudo systemctl status selah-bridge
pm2 list
```

**The run is skipped every night.** A lock left by a killed run. The script
clears stale locks by checking the PID, but you can remove it by hand:
`rm -rf /tmp/selah-devotion.lock`.

**Disk filling up.** OpenCode's database at
`~/.local/share/opencode/opencode.db` grows with use. Watch it with
`du -sh ~/.local/share/opencode/`.
