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
# Explicit env — wordpress image wp-config uses getenv_docker(WORDPRESS_DB_*)
"${SSH[@]}" 'WORDPRESS_DB_HOST=db WORDPRESS_DB_USER=wordpress WORDPRESS_DB_PASSWORD=wordpress WORDPRESS_DB_NAME=wordpress wp --path=/var/www/html core is-installed'

echo "lab-probe: PASS"
