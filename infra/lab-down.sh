#!/usr/bin/env bash
# Destroy all lab state (containers + volumes). Keys under .lab-keys are kept.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
docker compose -f "$ROOT/infra/compose.lab.yml" -p wpdevlab down -v
echo "lab-down: wpdevlab removed (volumes wiped)."
