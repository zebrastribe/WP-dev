#!/bin/sh
set -eu
WD="${WPDEV_TERMINAL_WORKDIR:-/workspace}"
if [ ! -d "$WD" ]; then WD=/workspace; fi

# Single-instance sync + terminal runners (supervisor-managed via Docker restart policy).
node /workspace/docker/terminal-runner.mjs >>/tmp/terminal-runner.log 2>&1 &
node /workspace/docker/host-runner.mjs >>/tmp/sync-runner.log 2>&1 &

exec ttyd -W -p 7681 -c "${WPDEV_TERMINAL_AUTH:-wpdev:wpdev}" -w "$WD" bash -lc "cd \"$WD\" && exec bash"
