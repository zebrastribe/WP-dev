# Permissions and ownership

**This is a core WP-dev contract.** Local WordPress must stay usable for:

1. Host `rsync` pull/push (your user)
2. IDE theme editing (your user)
3. wp-admin core / theme / plugin updates (`FS_METHOD=direct`, no FTP) as **www-data**

WordPress in Docker runs as **www-data** (uid 33). WP-dev reconciles ownership on every `up`, `pull`, theme pull, and local restore.

## Sync lifecycle (always)

| Phase | Command path | Ownership |
|-------|----------------|-----------|
| **Before host rsync** | `reconcileHostWritableForRsync` | Entire `wordpress/` → your uid:gid (so pull can write) |
| **After pull / up / restore** | `reconcileAfterPull` → `fix-runtime-permissions` | Entire tree → **host:www-data** (2775/664); then runtime dirs → **www-data** |

Skipping the after-sync step leaves core updates failing (“some files could not be copied”) or FTP prompts.

## The problem (without WP-dev)

- Docker creates files as www-data.
- `rsync pull` runs as your user → **Permission denied**.
- Host-only trees break wp-admin updates (FTP form / copy failures).
- `chmod 777` is insecure and still wrong for mixed host + Apache use.

## What WP-dev does automatically

| When | Action |
|------|--------|
| `wp-dev up` | Shared tree + runtime writability (`reconcileContainerRuntime`) |
| `wp-dev pull` / `pull theme` | Host-own before rsync; `reconcileAfterPull` after |
| `wp-dev restore local` (files) | `reconcileAfterPull` after extract |
| `wp-dev doctor` | Probes www-data write on runtime + `wp-admin` / themes |

## Ownership profiles

| Profile | Paths | Owner |
|---------|-------|-------|
| **Shared config** | `wp-dev.config.json`, `docker/.env` | Your user, mode 664 |
| **Shared (FS_METHOD=direct)** | Entire `wordpress/` tree | Your user : www-data group (dirs 2775, files 664) — core/theme updates + IDE |
| **Container runtime** | `plugins`, `uploads`, `upgrade`, `upgrade-temp-backup`, `cache`, `languages`, `mu-plugins`, `ai1wm-backups` | www-data (uid 33) — applied after the shared pass |

## Manual commands (when needed)

```bash
npm run wp-dev -- fix-permissions
npm run wp-dev -- fix-runtime-permissions
npm run wp-dev -- doctor --filesystem
```

Prefer `wp-dev up` or `doctor --filesystem` over manual `chmod`/`chown`.

## Plugin / theme update / migration errors

If wp-admin asks for **FTP credentials**, or cannot update plugins/themes, or All-in-One WP Migration cannot write `ai1wm-backups/`:

```bash
npm run wp-dev -- fix-runtime-permissions
# or full reconcile:
npm run wp-dev -- fix-permissions
npm run wp-dev -- doctor
```

Follows WordPress direct-filesystem practice on bind mounts: the whole tree is **host:www-data** group-writable so core updates can replace `wp-admin` / `wp-includes`; runtime content dirs are then owned by www-data.

## Related

- [Filesystem manager](../features/filesystem-manager.md)
- [Permission troubleshooting](../troubleshooting/permissions.md)
