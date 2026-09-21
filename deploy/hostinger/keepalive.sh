#!/bin/sh
# Keeps `opencode serve` and the bridge running on Hostinger shared hosting.
#
# WHY CRON AND NOT SUPERVISOR/SYSTEMD
#
# There is no root here, so systemd is out. supervisord would work, but it is
# itself a long-running process that something has to start and restart — the
# same problem one level up. Cron is already supervised by the host, runs
# whether or not anyone is logged in, and survives the process reaper that
# CloudLinux applies to shared accounts. So cron calls this, and this decides.
#
# LIVENESS IS CHECKED BY ASKING, NOT BY LOOKING
#
# A pgrep would call a wedged process healthy. These ask over HTTP instead: any
# reply at all (including 401, which is what a token-protected bridge SHOULD
# say to an unauthenticated probe) means the process is answering. Only a
# connection failure — curl code 000 — counts as down.
#
# Install (see README > Agent bridge status):
#   crontab -e
#   */5 * * * * /bin/sh $HOME/selah-bridge/deploy/hostinger/keepalive.sh

set -u

REPO="${SELAH_BRIDGE_REPO:-$HOME/selah-bridge}"
ENV_FILE="${SELAH_BRIDGE_ENV:-$HOME/.selah-bridge.env}"
LOCK="$HOME/.selah-keepalive.lock"
LOG="$HOME/keepalive.log"

# Cron runs with a near-empty PATH, so neither node nor opencode would be found.
export PATH="$HOME/.node/bin:$HOME/.opencode/bin:/usr/local/bin:/usr/bin:/bin"

# BRIDGE_TOKEN and OPENCODE_SERVER_PASSWORD live here rather than in the repo,
# so they are never committed. chmod 600.
#
# `set -a` matters: sourcing alone makes them shell variables, NOT environment
# variables, so the processes started below would not inherit them. The bridge
# would come back up with no token — and because bridge.php reaches it over
# loopback, the proxy fail-safe would not catch that either. The result would
# be a publicly reachable bridge with its authentication silently switched off.
set -a
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
set +a

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# Only one run at a time. mkdir is atomic, so two overlapping crons cannot both
# decide a process is down and start two copies of it.
if ! mkdir "$LOCK" 2>/dev/null; then
  # A lock left behind by a killed run would block this forever, so treat an
  # old one as stale. `find -mmin` avoids depending on stat(1) flags, which
  # differ between GNU and BSD.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    log "removing a stale lock"
    rmdir "$LOCK" 2>/dev/null || true
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

responds() {
  # curl ALREADY prints 000 via -w when the connection fails, and also exits
  # non-zero. A `|| echo 000` fallback therefore appends a second one, giving
  # "000000" — which is not "000", so every dead port read as alive and this
  # script would never restart anything. Take the -w output as the only source.
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$@" 2>/dev/null)
  [ -n "$code" ] && [ "$code" != "000" ]
}

# --- OpenCode ---------------------------------------------------------------
if responds http://127.0.0.1:4097/global/health; then
  :
else
  log "opencode is not answering — starting it"
  if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
    log "WARNING: OPENCODE_SERVER_PASSWORD is not set — port 4097 is unauthenticated"
  fi
  nohup opencode serve --port 4097 --hostname 127.0.0.1 >> "$HOME/opencode.log" 2>&1 &
  # The bridge reports OpenCode's health too, so give it a moment to bind
  # before the bridge is judged.
  sleep 5
fi

# --- Bridge -----------------------------------------------------------------
# 401 is a healthy answer from a token-protected bridge, so this probe does not
# need the token to tell "up" from "down".
if responds http://127.0.0.1:4098/api/health; then
  :
else
  log "bridge is not answering — starting it"
  if [ ! -d "$REPO" ]; then
    log "ERROR: repo not found at $REPO — clone it first"
    exit 1
  fi
  cd "$REPO" || exit 1
  nohup npm run bridge >> "$HOME/bridge.log" 2>&1 &
fi

# Keep the logs from growing without bound; shared accounts have a disk quota.
for f in "$LOG" "$HOME/bridge.log" "$HOME/opencode.log"; do
  if [ -f "$f" ] && [ "$(wc -l < "$f" 2>/dev/null || echo 0)" -gt 2000 ]; then
    tail -n 500 "$f" > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f"
  fi
done
