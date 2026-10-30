#!/usr/bin/env bash
# P1.5 acceptance: SSH → wp core is-installed + rsync --version (loopback only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$ROOT/infra/.lab-keys/lab_ed25519"
SSH=(ssh -i "$KEY" -p 2222
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o GlobalKnownHostsFile=/dev/null
  -o BatchMode=yes
  -o ConnectTimeout=10
  lab@127.0.0.1)

if [[ ! -f "$KEY" ]]; then
  echo "lab-probe: missing key — run ./infra/lab-up.sh first" >&2
  exit 2
fi

echo "lab-probe: rsync --version via SSH…"
"${SSH[@]}" 'rsync --version' | head -1

echo "lab-probe: wp core is-installed via SSH…"
# WORDPRESS_DB_* come from ~/.ssh/environment (PermitUserEnvironment in lab sshd).
"${SSH[@]}" 'wp --path=/var/www/html core is-installed'

echo "lab-probe: PASS"
