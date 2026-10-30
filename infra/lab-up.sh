#!/usr/bin/env bash
# Bring up the disposable wpdevlab stack and install WordPress once.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/infra/compose.lab.yml" -p wpdevlab)
KEYS="$ROOT/infra/.lab-keys"

mkdir -p "$KEYS"
chmod 700 "$KEYS"
if [[ ! -f "$KEYS/lab_ed25519" ]]; then
  ssh-keygen -t ed25519 -N "" -f "$KEYS/lab_ed25519" -C "wpdev-lab-only" >/dev/null
  echo "lab-up: generated $KEYS/lab_ed25519"
fi
cp "$KEYS/lab_ed25519.pub" "$KEYS/authorized_keys"
chmod 600 "$KEYS/lab_ed25519" "$KEYS/authorized_keys"

echo "lab-up: starting stack (loopback 18080 / 2222)…"
"${COMPOSE[@]}" up -d --build

echo "lab-up: waiting for WordPress files…"
for i in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T wordpress test -f /var/www/html/wp-settings.php 2>/dev/null; then
    break
  fi
  sleep 2
done

echo "lab-up: ensuring WordPress is installed…"
if ! "${COMPOSE[@]}" run --rm --no-deps wpcli core is-installed 2>/dev/null; then
  "${COMPOSE[@]}" run --rm --no-deps wpcli core install \
    --url="http://127.0.0.1:18080" \
    --title="wp-dev lab" \
    --admin_user="labadmin" \
    --admin_password="labadmin-not-for-prod" \
    --admin_email="lab@localhost.local" \
    --skip-email
fi

echo "lab-up: ready. Probe with: ./infra/lab-probe.sh"
echo "lab-up: tear down with: ./infra/lab-down.sh"
