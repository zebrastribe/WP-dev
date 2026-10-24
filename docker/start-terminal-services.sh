#!/bin/sh
set -eu
WD="${WPDEV_TERMINAL_WORKDIR:-/workspace}"
if [ ! -d "$WD" ]; then WD=/workspace; fi

AUTH="${WPDEV_TERMINAL_AUTH:-}"
if [ -z "$AUTH" ] || [ "$AUTH" = "wpdev:wpdev" ] || [ "$AUTH" = "change-me-user:change-me-password" ]; then
  echo "WPDEV_TERMINAL_AUTH must be set to a non-default user:password (run wp-dev up)." >&2
  exit 1
fi

# Single-instance sync + terminal runners (supervisor-managed via Docker restart policy).
node /workspace/docker/terminal-runner.mjs >>/tmp/terminal-runner.log 2>&1 &
node /workspace/docker/host-runner.mjs >>/tmp/sync-runner.log 2>&1 &

exec ttyd -W -p 7681 -c "$AUTH" -w "$WD" bash -lc "cd \"$WD\" && exec bash"
