# SSH troubleshooting

## Host not pinned (not in known_hosts)

**Symptoms:** `SSH host [hostname]:port is not pinned in ~/.ssh/known_hosts`

**Cause:** WP-dev requires SSH hosts to be pinned before connecting. This prevents man-in-the-middle attacks.

**Fix:** Connect once with OpenSSH to verify and pin the host key. Use the same identity file and port from your config:

```bash
ssh -i ~/.ssh/your-key -p 2222 user@host
```

When prompted "Are you sure you want to continue connecting?", verify the fingerprint and type `yes`.

**Verify:** `npm run wp-dev -- doctor staging`

---

## Permission denied (publickey)

**Symptoms:** `pull` or `doctor` fails with `Permission denied (publickey)`.

**Cause:** Wrong host/user, key not on server, or wrong `identityFile`.

**Fix:**

1. Test manually with the exact options from config:
   ```bash
   ssh -i ~/.ssh/your-key -p PORT user@host
   ```
2. Upload your public key (`~/.ssh/your-key.pub`) to the host panel or `~/.ssh/authorized_keys` on the server.
3. Set `identityFile` in config if not using default key — prefer `~/.ssh/your-key` (not an absolute path like `/home/you/.ssh/...`).

**Verify:** `npm run wp-dev -- doctor staging`

---

## Unprotected private key file

**Symptoms:** `UNPROTECTED PRIVATE KEY FILE` or `Permissions ... are too open`

**Cause:** Your private key has permissions that allow other users to read it (e.g., mode 644).

**Fix:**

```bash
chmod 600 ~/.ssh/your-key
```

OpenSSH refuses keys readable by other users.

**Verify:** `ls -la ~/.ssh/your-key` should show `-rw-------`

---

## Identity file not accessible (browser terminal / Docker)

**Symptoms:** `Identity file /home/you/.ssh/key.pem not accessible` when using sync from `/admin/` or the in-container terminal.

**Cause:** Config stores a host absolute path, but the browser terminal runs inside Docker with your keys mounted at `/root/.ssh`.

**Fix:** Use `~/.ssh/your-key` in `identityFile`, or update WP-dev (0.1.0+) which remaps `.ssh` paths automatically. Re-run `wp-dev init` to normalize an existing path.

**Verify:** `npm run wp-dev -- doctor staging --rsync`

---

## Passphrase-protected key

**Symptoms:** SSH hangs or times out; no visible prompt for passphrase.

**Cause:** Key has a passphrase but no ssh-agent is running (or key not loaded).

**Fix:**

1. Start an agent and load the key:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/your-key
   ```
2. Or use a key without a passphrase for automated syncing.

**Note:** The Docker container has no agent forwarding, so passphrase prompts fail silently in the browser terminal.

**Verify:** `ssh-add -l` should list your key.

---

## SSH config alias not working

**Symptoms:** Host works with `ssh myalias` but WP-dev says "not pinned" or auth fails.

**Cause:** WP-dev ignores `~/.ssh/config` (uses `-F /dev/null` for safety). Host aliases, per-host ports, and identity files from config are not used.

**Fix:** Put the real values in `wp-dev.config.json`:

- `host`: the actual hostname (not an alias)
- `port`: explicit port number
- `identityFile`: explicit key path

**Verify:** `npm run wp-dev -- doctor staging`

---

## Authenticated with partial success

**Symptoms:** SSH connects but WP-dev still fails.

**Cause:** Server wants a second password step after the key.

**Fix:** Use a key the host accepts without keyboard-interactive auth, or sync manually outside WP-dev.

**Verify:** `ssh user@host` should not prompt for a password after the key.

---

## Wrong path / rsync errors

**Symptoms:** rsync cannot find files or permission denied on remote.

**Cause:** `path` in config is not the WordPress root.

**Fix:** SSH in, run `pwd` and `ls wp-config.php`. Update `path` in config.

**Verify:** `npm run wp-dev -- doctor staging --rsync`

---

## Path safety: parent folder or WP-dev in docroot

**Symptoms:** `doctor` reports `Path safety: FAIL` — parent of sites, missing `wp-config.php`, or wp-dev tooling in docroot.

**Cause:** `path` points at a shared parent (other sites/logs), or the WP-dev git project was copied into the live site folder.

**Fix:**

1. Set `path` to the directory that contains **this** site's `wp-config.php`.
2. Keep other sites and logs as **siblings**, not under that path.
3. Remove any WP-dev checkout from production/staging docroot; run WP-dev only on your machine (or a non-web directory).

**Verify:** `npm run wp-dev -- doctor staging`

---

## Related

- [SSH setup](../getting-started/ssh.md)
- [Shared hosting](../guides/shared-hosting.md)
