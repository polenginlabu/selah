#!/bin/sh

BRIDGE_HEALTH_URL="http://127.0.0.1:4098/api/health"
BRIDGE_DIR="/var/www/html/opencode-bridge"
NODE_BIN="/usr/bin/node"
LOG_FILE="/tmp/opencode-bridge.log"

# If health check fails, try to start the bridge.
if ! curl -fsS "$BRIDGE_HEALTH_URL" >/dev/null 2>&1; then
  if ! pgrep -f "node $BRIDGE_DIR/server.js" >/dev/null 2>&1; then
    nohup "$NODE_BIN" "$BRIDGE_DIR/server.js" >> "$LOG_FILE" 2>&1 &
  fi
fi
