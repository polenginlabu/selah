#!/bin/sh
# Health check for the bridge + opencode pair. Run by selah-health.timer.
#
# Kept as a script rather than an inline ExecStart because systemd's quoting
# rules are not the shell's, and a one-liner with nested quotes fails to load
# in ways that are tedious to debug.
#
# What it catches that Restart=always cannot: the bridge staying up and
# answering while OpenCode behind it is dead or wedged. Every prompt then
# returns an empty reply rather than an error, so systemd sees a healthy
# process and does nothing. /api/health reports OpenCode's state too, which is
# why it is the thing worth checking.
set -eu

BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:4098}"
UNITS="${UNITS:-opencode selah-bridge}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] $*"; }

if curl -fsS -m 10 "$BRIDGE_URL/api/health" 2>/dev/null | grep -q '"success":true'; then
  exit 0
fi

log "unhealthy at $BRIDGE_URL — restarting: $UNITS"
# shellcheck disable=SC2086
systemctl restart $UNITS
log "restart issued"
