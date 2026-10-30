#!/usr/bin/env bash
# P1.6 — Backup DB → mutate → restore → verify on the disposable lab (loopback only).
# Prereq: ./infra/lab-up.sh && npm run build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$ROOT/infra/.lab-keys/lab_ed25519"
CLI="$ROOT/dist/cli.js"
PROJECT="wpdev-lab-roundtrip"

SSH=(ssh -i "$KEY" -p 2222
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o GlobalKnownHostsFile=/dev/null
  -o BatchMode=yes
  -o ConnectTimeout=10
  lab@127.0.0.1)

die() { echo "lab-restore-roundtrip: $*" >&2; exit 1; }

[[ -f "$KEY" ]] || die "missing key — run ./infra/lab-up.sh first"
[[ -f "$CLI" ]] || die "missing $CLI — run npm run build first"

echo "lab-restore-roundtrip: probing lab…"
"$ROOT/infra/lab-probe.sh"

MARKER_A="lab-roundtrip-A-$(date +%s)"
MARKER_B="lab-roundtrip-B-$(date +%s)"
TMP="$(mktemp -d /tmp/wpdev-lab-rt-XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

cat >"$TMP/wp-dev.config.json" <<EOF
{
  "project": "$PROJECT",
  "local": {
    "url": "http://127.0.0.1:18080",
    "path": "./docker",
    "wpRoot": "./wordpress"
  },
  "staging": {
    "host": "127.0.0.1",
    "port": 2222,
    "user": "lab",
    "path": "/var/www/html",
    "url": "http://127.0.0.1:18080",
    "identityFile": "$KEY"
  },
  "production": {
    "host": "127.0.0.1",
    "port": 2222,
    "user": "lab",
    "path": "/var/www/html",
    "url": "http://127.0.0.1:18080",
    "identityFile": "$KEY"
  }
}
EOF
mkdir -p "$TMP/docker" "$TMP/wordpress"

wp_lab() {
  "${SSH[@]}" "wp --path=/var/www/html $*"
}

echo "lab-restore-roundtrip: set blogname=$MARKER_A"
wp_lab option update blogname "$MARKER_A" >/dev/null

echo "lab-restore-roundtrip: CLI backup staging…"
(
  cd "$TMP"
  WPDEV_SSH_INSECURE=1 node "$CLI" backup staging
)

BACKUP="$(ls -1t "$HOME/.wp-dev/backups/$PROJECT/staging"/db-*.sql | head -1)"
[[ -n "$BACKUP" && -s "$BACKUP" ]] || die "backup file missing after CLI backup"
echo "lab-restore-roundtrip: backup=$BACKUP"

echo "lab-restore-roundtrip: mutate blogname=$MARKER_B"
wp_lab option update blogname "$MARKER_B" >/dev/null
GOT_B="$(wp_lab option get blogname 2>/dev/null | tr -d '\r')"
[[ "$GOT_B" == "$MARKER_B" ]] || die "mutate failed (got '$GOT_B')"

echo "lab-restore-roundtrip: CLI restore staging…"
(
  cd "$TMP"
  WPDEV_SSH_INSECURE=1 node "$CLI" restore staging "$BACKUP" \
    --yes --confirm-host 127.0.0.1
)

GOT_A="$(wp_lab option get blogname 2>/dev/null | tr -d '\r')"
echo "lab-restore-roundtrip: blogname after restore=$GOT_A"
[[ "$GOT_A" == "$MARKER_A" ]] || die "restore did not restore marker (expected '$MARKER_A')"

echo "lab-restore-roundtrip: PASS"
