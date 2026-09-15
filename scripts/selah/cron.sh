#!/bin/sh
# SELAH daily devotional — cron entry point.
#
# Writes one devotion for today, shared by every user. Safe to run repeatedly:
# the generator is idempotent by date, so a retry, an overlapping schedule or a
# manual run costs nothing once the day's devotion exists.
#
# Install (crontab -e), 03:00 daily:
#   0 3 * * * /var/www/html/selah-app/scripts/selah/cron.sh >> /var/log/selah-devotion.log 2>&1
#
# cron runs with a near-empty environment and / as the working directory, which
# is the usual reason a script that works in a shell fails at 3am. Everything
# below is explicit for that reason: absolute paths, an explicit PATH, and an
# explicit cd.

set -eu

# --- Configuration ----------------------------------------------------------
# Override any of these in the crontab line itself, e.g.
#   0 3 * * * SELAH_DIR=/srv/selah /srv/selah/scripts/selah/cron.sh
SELAH_DIR="${SELAH_DIR:-$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)}"
BRIDGE_DIR="${BRIDGE_DIR:-$SELAH_DIR/backend/bridge/opencode-bridge}"
BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:4098}"
OPENCODE_PORT="${OPENCODE_PORT:-4097}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /usr/bin/node)}"
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode || echo /usr/local/bin/opencode)}"
LOCK_DIR="${LOCK_DIR:-/tmp/selah-devotion.lock}"
STARTUP_WAIT="${STARTUP_WAIT:-30}"

PATH="$(dirname -- "$NODE_BIN"):$(dirname -- "$OPENCODE_BIN"):/usr/local/bin:/usr/bin:/bin"
export PATH

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

# --- Single instance --------------------------------------------------------
# mkdir is atomic on every POSIX filesystem, which flock is not (and flock is
# absent on macOS). A run that takes 80s under a daily schedule should never
# overlap, but a hung bridge plus a manual run would, and two concurrent agent
# runs cost double for one devotion.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -f "$LOCK_DIR/pid" ] && kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
    log "another run is still going (pid $(cat "$LOCK_DIR/pid")) — skipping"
    exit 0
  fi
  log "clearing a stale lock from a run that died"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || fail "could not take the lock at $LOCK_DIR"
fi
echo $$ > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

cd "$SELAH_DIR" || fail "SELAH_DIR does not exist: $SELAH_DIR"
[ -f scripts/generate-daily-devotion.js ] || fail "not a selah checkout: $SELAH_DIR"
[ -f .env.local ] || fail "missing $SELAH_DIR/.env.local (see .env.local.example)"

# --- Dependencies -----------------------------------------------------------
# Both are long-running processes that do not survive a reboot on their own, so
# start them if they are down rather than failing the night's devotion.
started_something=0

if ! curl -fsS -m 5 "http://127.0.0.1:$OPENCODE_PORT/global/health" >/dev/null 2>&1; then
  log "opencode serve is down — starting it on port $OPENCODE_PORT"
  nohup "$OPENCODE_BIN" serve --port "$OPENCODE_PORT" --hostname 127.0.0.1 \
    >> /tmp/selah-opencode.log 2>&1 &
  started_something=1
fi

if ! curl -fsS -m 5 "$BRIDGE_URL/api/health" >/dev/null 2>&1; then
  log "bridge is down — starting it"
  [ -d "$BRIDGE_DIR" ] || fail "bridge directory not found: $BRIDGE_DIR"
  ( cd "$BRIDGE_DIR" && OPENCODE_ROOT_PATH="$SELAH_DIR" nohup "$NODE_BIN" server.js \
    >> /tmp/selah-bridge.log 2>&1 & )
  started_something=1
fi

if [ "$started_something" = "1" ]; then
  log "waiting up to ${STARTUP_WAIT}s for the bridge to be ready"
  i=0
  while [ "$i" -lt "$STARTUP_WAIT" ]; do
    if curl -fsS -m 5 "$BRIDGE_URL/api/health" 2>/dev/null | grep -q '"success":true'; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
fi

# A healthy bridge with an unhealthy OpenCode answers every prompt with an
# empty reply, so check for the composite health, not just a listening port.
if ! curl -fsS -m 10 "$BRIDGE_URL/api/health" 2>/dev/null | grep -q '"success":true'; then
  fail "bridge/opencode not healthy at $BRIDGE_URL — see /tmp/selah-bridge.log and /tmp/selah-opencode.log"
fi

# --- Generate ---------------------------------------------------------------
log "generating today's devotion"
if "$NODE_BIN" scripts/generate-daily-devotion.js "$@"; then
  log "done"
else
  status=$?
  fail "generator exited with status $status (rejected output is kept in $SELAH_DIR/.selah-debug)"
fi
