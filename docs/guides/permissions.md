# Permissions and ownership

**LOCAL Docker only.** `fix-permissions` / post-pull reconcile run via `docker compose` on the bind-mounted `wordpress/` tree. They do **not** SSH into staging or production and do not change remote ownership. `push` uses rsync `--no-owner --no-group`, so remote hosts keep their existing owners.

**This is a core WP-dev contract for localhost.** Local WordPress must stay usable for:

1. Host `rsync` pull/push (your user)
2. IDE theme editing (your user)
3. wp-admin core / theme / plugin updates (`FS_METHOD=direct`, no FTP) as **www-data**

WordPress in Docker runs as **www-data** (uid 33). WP-dev reconciles ownership on every `up`, `pull`, theme pull, and local restore.

## Sync lifecycle (always)

Do **not** call pre/post permission helpers ad hoc from new commands. Use the envelope:

`runLocalWordpressFileMutation(loaded, { label }, work)`

| Phase | Inside the envelope | Ownership |
|-------|---------------------|-----------|
| **1. Before host rsync** | `reconcileHostWritableForRsync` | Entire `wordpress/` → your uid:gid (so pull/restore can write) |
| **2. Work** | Your rsync / extract / DB import | — |
| **3. After success** | `reconcileAfterPull` → runtime + shared config | Entire tree → **host:www-data** (2775/664); then runtime dirs → **www-data** |

Skipping step 1 → host rsync **Permission denied**. Skipping step 3 → core updates fail (“some files could not be copied”) or FTP prompts.

## The problem (without WP-dev)

- Docker creates files as www-data.
- `rsync pull` runs as your user → **Permission denied**.
- Host-only trees break wp-admin updates (FTP form / copy failures).
- `chmod 777` is insecure and still wrong for mixed host + Apache use.

## What WP-dev does automatically

| When | Action |
|------|--------|
| `wp-dev up` | Shared tree + runtime writability (`reconcileContainerRuntime`) |
| `wp-dev pull` / `pull theme` | `runLocalWordpressFileMutation` (host → rsync → after) |
| `wp-dev restore local` (archive) | Same envelope around local rsync + DB import |
| `wp-dev doctor` | Probes www-data write on runtime + `wp-admin` / themes |

## Ownership profiles

| Profile | Paths | Owner |
|---------|-------|-------|
| **Shared config** | `wp-dev.config.json`, `docker/.env` | Your user, mode 664 / 660 |
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
