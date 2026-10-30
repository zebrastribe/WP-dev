# Lab fixture (Phase 1 — §25 P1.5)

Disposable **localhost** SSH + WordPress stack for sync/restore tests. **No Hetzner / cloud account required.**

| Port | Bind | Service |
|------|------|---------|
| 18080 | `127.0.0.1` | WordPress HTTP |
| 2222 | `127.0.0.1` | SSH (user `lab`, key-only) |

Remote WordPress path: `/var/www/html`.

## Commands

```bash
./infra/lab-up.sh      # build, start, install WP once
./infra/lab-probe.sh   # SSH: rsync --version + wp core is-installed
./infra/lab-down.sh    # compose down -v (wipes volumes)
```

Keys live in `infra/.lab-keys/` (gitignored). Regenerated on first `lab-up.sh`.

## Hard rules

- Loopback publishes only — never expose this stack on LAN/WAN.
- Lab passwords are throwaway (`labadmin-not-for-prod`); never reuse for real sites.
- Tear down with `lab-down.sh` when finished; do not leave it running as a substitute for staging.
