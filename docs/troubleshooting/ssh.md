# SSH troubleshooting

## Permission denied (publickey)

**Symptoms:** `pull` or `doctor` fails with `Permission denied (publickey)`.

**Cause:** Wrong host/user, key not on server, or wrong `identityFile`.

**Fix:**

1. Test manually: `ssh -i ~/.ssh/id_ed25519 user@host`
2. Upload `~/.ssh/id_ed25519.pub` to the host panel.
3. Set `identityFile` in config if not using default key — prefer `~/.ssh/your-key` (not a host absolute path like `/home/you/.ssh/...`).

**Verify:** `npm run wp-dev -- doctor production`

---

## Identity file not accessible (browser terminal / Docker)

**Symptoms:** `Identity file /home/you/.ssh/key.pem not accessible` when using sync from `/admin/` or the in-container terminal.

**Cause:** Config stores a host absolute path, but the browser terminal runs inside Docker with your keys mounted at `/root/.ssh`.

**Fix:** Use `~/.ssh/your-key` in `identityFile`, or update WP-dev (0.1.0+) which remaps `.ssh` paths automatically. Re-run `wp-dev init` to normalize an existing path.

**Verify:** `npm run wp-dev -- doctor staging --rsync`

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

**Verify:** `npm run wp-dev -- doctor production --rsync`

---

## Related

- [SSH setup](../getting-started/ssh.md)
- [Shared hosting](../guides/shared-hosting.md)
