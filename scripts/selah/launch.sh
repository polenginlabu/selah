#!/bin/sh
# SELAH local dev launcher — one command to run OpenCode + the bridge.
#
# Starts OpenCode (127.0.0.1:4097) and the bridge (127.0.0.1:4098) if they are
# not already running, waits until both are healthy, then holds the session.
# Ctrl+C (SIGINT/SIGTERM) stops only the processes THIS script started, so an
# already-running opencode/bridge on another terminal is left alone.
#
# Usage:
#   npm run bridge:launch
#   ./scripts/selah/launch.sh
#
# Environment overrides:
#   OPENCODE_PORT=4097  OPENCODE_BIN=/path/to/opencode
#   BRIDGE_URL=http://127.0.0.1:4098  BRIDGE_DIR=/path/to/opencode-bridge
#   STARTUP_WAIT=30

set -eu

SELAH_DIR="${SELAH_DIR:-$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)}"
BRIDGE_DIR="${BRIDGE_DIR:-$SELAH_DIR/backend/bridge/opencode-bridge}"
BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:4098}"
OPENCODE_PORT="${OPENCODE_PORT:-4097}"
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode || echo /usr/local/bin/opencode)}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /usr/bin/node)}"
STARTUP_WAIT="${STARTUP_WAIT:-30}"

PATH="$(dirname -- "$NODE_BIN"):$(dirname -- "$OPENCODE_BIN"):/usr/local/bin:/usr/bin:/bin"
export PATH

log() { echo "[$(date '+%H:%M:%S')] $*"; }

cd "$SELAH_DIR" || { echo "ERROR: SELAH_DIR does not exist: $SELAH_DIR" >&2; exit 1; }
[ -d "$BRIDGE_DIR" ] || { echo "ERROR: bridge not found: $BRIDGE_DIR (run npm run bridge:install first)" >&2; exit 1; }

# PIDs of processes we started; only these get killed on exit.
started=""
cleanup_done=0

cleanup() {
  [ "$cleanup_done" = "1" ] && exit 0
  cleanup_done=1
  if [ -n "$started" ]; then
    log "stopping processes this script started: $started"
    kill $started 2>/dev/null || true
  else
    log "nothing to stop (left the pre-existing processes running)"
  fi
  exit 0
}
trap cleanup INT TERM EXIT

# --- OpenCode (4097) ---------------------------------------------------------
if curl -fsS -m 5 "http://127.0.0.1:$OPENCODE_PORT/global/health" >/dev/null 2>&1; then
  log "opencode already running on 127.0.0.1:$OPENCODE_PORT"
else
  log "starting opencode on 127.0.0.1:$OPENCODE_PORT"
  "$OPENCODE_BIN" serve --port "$OPENCODE_PORT" --hostname 127.0.0.1 &
  started="$started $!"
fi

# --- Bridge (4098) ----------------------------------------------------------
if curl -fsS -m 5 "$BRIDGE_URL/api/health" >/dev/null 2>&1; then
  log "bridge already running at $BRIDGE_URL"
else
  log "starting bridge at $BRIDGE_URL"
  ( cd "$BRIDGE_DIR" && OPENCODE_ROOT_PATH="$SELAH_DIR" "$NODE_BIN" server.js ) &
  started="$started $!"
fi

# --- Wait for composite health ----------------------------------------------
log "waiting up to ${STARTUP_WAIT}s for bridge + opencode to be healthy"
i=0
while [ "$i" -lt "$STARTUP_WAIT" ]; do
  if curl -fsS -m 5 "$BRIDGE_URL/api/health" 2>/dev/null | grep -q '"success":true'; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

if curl -fsS -m 5 "$BRIDGE_URL/api/health" 2>/dev/null | grep -q '"success":true'; then
  log "ready: opencode=127.0.0.1:$OPENCODE_PORT  bridge=$BRIDGE_URL  root=$SELAH_DIR"
  log "press Ctrl+C to stop."
  # Hold the session. The trap stops only what we started.
  while :; do sleep 60; done
else
  log "ERROR: bridge/opencode not healthy — see the process output above"
  log "hint: opencode=127.0.0.1:$OPENCODE_PORT, bridge=$BRIDGE_URL"
  exit 1
fi