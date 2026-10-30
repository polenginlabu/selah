#!/bin/sh
# Brings the server's repo copy (the bridge and agent workspace) up to date.
# Run by .github/workflows/deploy.yml over SSH as `selah`, after `git pull`:
#
#   cd /var/www/selah-app && before=$(git rev-parse HEAD) && git pull --ff-only -q \
#     && sh deploy/update-server.sh "$before"
#
# The pull happens in the workflow, not here, so this script always runs as the
# version that was just pulled. Given the commit from before the pull, it
# reinstalls and restarts the bridge only when the bridge itself changed — a
# website-only push leaves running explanations alone.
#
# Needs the sudoers rule from deploy/digitalocean.md ("Automatic server
# updates") so the restart works without a password.
set -eu

before="${1:?usage: update-server.sh <commit before pull>}"
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ]; then
  echo "server repo: already at $after"
  exit 0
fi

if git diff --quiet "$before" "$after" -- backend/bridge; then
  echo "server repo: $before -> $after (bridge unchanged)"
  exit 0
fi

echo "server repo: $before -> $after (bridge changed, restarting)"
npm run bridge:install --silent
sudo -n /usr/bin/systemctl restart selah-bridge

# Fail the deploy if the bridge did not come back.
i=0
until systemctl is-active --quiet selah-bridge; do
  i=$((i + 1))
  if [ "$i" -ge 15 ]; then
    echo "selah-bridge did not start; see journalctl -u selah-bridge" >&2
    exit 1
  fi
  sleep 1
done
echo "selah-bridge restarted"
