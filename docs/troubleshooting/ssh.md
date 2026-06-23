# SSH troubleshooting

## Permission denied (publickey)

**Symptoms:** `pull` or `doctor` fails with `Permission denied (publickey)`.

**Cause:** Wrong host/user, key not on server, or wrong `identityFile`.

**Fix:**

1. Test manually: `ssh -i ~/.ssh/id_ed25519 user@host`
2. Upload `~/.ssh/id_ed25519.pub` to the host panel.
3. Set `identityFile` in config if not using default key.

**Verify:** `npm run wp-dev -- doctor production`

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
