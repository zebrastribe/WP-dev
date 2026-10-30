# Shared hosting (Simply, UnoEuro-style)

Shared hosts often differ from VPS layouts. `wp-dev init` guesses may not match your panel.

## Common differences

| Topic | Typical shared hosting |
|-------|------------------------|
| **SSH hostname** | Cluster name from panel (e.g. `linux159.unoeuro.com`), not your domain |
| **SSH user** | Account or domain string, not `deploy` |
| **Path** | `/var/www/domain/public_html` or `/customers/…/httpd.www` — confirm with `pwd` and `ls wp-config.php` over SSH |
| **Site URL** | Must match DB `siteurl`/`home` — `www` vs bare domain, `http` vs `https` |

## Workflow

1. SSH in manually and find the WordPress root (`wp-config.php` location).
2. Run `wp-dev init` with those exact values.
3. `wp-dev doctor production --rsync` before first pull.
4. See [Syncing — first pull checklist](../guides/syncing.md#first-pull-checklist).

## SSH keys on Simply.com / UnoEuro (authorized_keys)

Many shared hosts enable SSH only after you install a public key. There are two ways to do this:

### Option A: Hosting panel (recommended)

Most control panels have an "SSH keys" or "SFTP keys" section:

1. Generate a key locally: `ssh-keygen -t ed25519 -f ~/.ssh/site_ed25519`
   (use an empty passphrase or remember to run `ssh-add` before syncing)
2. Copy the **public** key: `cat ~/.ssh/site_ed25519.pub`
3. Paste into the hosting panel's SSH keys section.
4. Set `production.identityFile` (and staging if used) in `wp-dev.config.json` to `~/.ssh/site_ed25519`.
5. Pin the host key: `ssh -i ~/.ssh/site_ed25519 user@host` (accept fingerprint when prompted).
6. `npm run wp-dev -- doctor production` then `doctor production --rsync`.

### Option B: Manual authorized_keys file

If the panel has no SSH keys section, upload the file yourself:

1. Generate a key locally: `ssh-keygen -t ed25519 -f ~/.ssh/site_ed25519`
2. Create `~/.ssh` on the account (via FTP/file manager if needed).
3. Upload `authorized_keys` containing your **public** key line (the `.pub` file contents).
4. Set permissions on the host: `.ssh` → `700`, `authorized_keys` → `600` (owner = FTP/SSH user).
5. Set `production.identityFile` in `wp-dev.config.json` to `~/.ssh/site_ed25519`.
6. Pin the host key: `ssh -i ~/.ssh/site_ed25519 user@host` (accept fingerprint when prompted).
7. `npm run wp-dev -- doctor production` then `doctor production --rsync`.

Password-only FTP accounts cannot use key SSH until authorized_keys exists.

### Key permissions

Your **local** private key must have mode 600:

```bash
chmod 600 ~/.ssh/site_ed25519
```

OpenSSH refuses keys that are readable by other users ("UNPROTECTED PRIVATE KEY FILE").

## One site per `path` (important)

`staging.path` / `production.path` must be **this site’s** WordPress root — the folder that contains `wp-config.php`.

Do **not** point path at:

- The account home or a parent that also holds other sites or log folders
- A checkout of the **WP-dev** project (the CLI/admin repo belongs on your workstation, not inside the live docroot)

Sibling sites and logs should sit **beside** that folder.

Safety nets:

- **Setup** → **Verify path** checks SSH + `wp-config.php` at the configured path (and refuses WP-dev tooling in the docroot).
- **`wp-dev doctor`** fails on multi-site parents or wp-dev-in-docroot.
- **pull / push / backup / restore / theme sync** refuse unsafe remote paths before touching files.

## Staging HTTP password (recommended)

Protect the staging URL with Apache HTTP basic auth so visitors cannot browse unfinished work:

1. In **Setup** → staging, leave **Protect staging with HTTP user/password** on (default).
2. **Save** config (credentials are stored in `staging.httpAuth`).
3. Run **Apply HTTP auth on staging** (or `npm run wp-dev -- staging-http-auth enable`).

Username is shown in Setup; password is masked with Reveal/Copy. SSH pull/push do **not** use this password.

Disable later with `npm run wp-dev -- staging-http-auth disable`.

Hosts that ignore `.htaccess` Auth* directives need panel “directory protection” instead — WP-dev cannot force that.

## Simply.com DNS API (optional)

With `simply.account` in config and `WPDEV_SIMPLY_API_KEY` in `docker/.env`:

```bash
npm run wp-dev -- simply test
npm run wp-dev -- simply setup-staging-dns example.com
```

Creates a staging A record and refreshes staging hints in config. Does **not** create hosting or WordPress on the server.

## Related

- [SSH setup](../getting-started/ssh.md)
- [SSH troubleshooting](../troubleshooting/ssh.md)
