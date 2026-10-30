# SSH keys and server access

WP-dev uses **SSH** and **rsync** to copy files and run **WP-CLI** on your server. It does not store passwords — only SSH keys.

## What you need

1. An SSH key on your computer (with mode 600 permissions).
2. The **public** key uploaded to your hosting panel or server.
3. The host key pinned in your local `~/.ssh/known_hosts`.
4. SSH host, username, and WordPress path in `wp-dev.config.json`.

## Step 1 — Create a key (one time per computer)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519
```

Press Enter for no passphrase (recommended for WP-dev), or set one and load the key with `ssh-add` before syncing.

**Set secure permissions:**

```bash
chmod 600 ~/.ssh/id_ed25519
```

OpenSSH refuses keys readable by other users ("UNPROTECTED PRIVATE KEY FILE").

**macOS — remember the key after reboot:**

```bash
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

## Step 2 — Upload the public key

Copy the contents of:

```bash
cat ~/.ssh/id_ed25519.pub
```

- **VPS:** add to `~/.ssh/authorized_keys` for your deploy user.
- **Shared hosting:** paste into the control panel (SSH / SFTP / SSH keys section). On Simply.com / UnoEuro, you may need to upload `authorized_keys` via FTP — see [Shared hosting](../guides/shared-hosting.md#ssh-keys-on-simplycom--unoeuro-authorized_keys).

Never upload the private key (the file **without** `.pub`).

## Step 3 — Pin the host key

WP-dev refuses SSH connections to hosts not pinned in `~/.ssh/known_hosts`. Connect once manually to verify and save the fingerprint:

```bash
ssh -i ~/.ssh/id_ed25519 user@your-ssh-host.example.com
```

If using a non-default port:

```bash
ssh -i ~/.ssh/id_ed25519 -p 2222 user@your-ssh-host.example.com
```

When prompted "Are you sure you want to continue connecting?", verify the fingerprint matches your host and type `yes`. This pins the host key.

If connection succeeds (even briefly), the host is pinned. You can exit immediately.

## Step 4 — Add to WP-dev config

**Browser:** `/admin/` wizard → SSH steps.

**Terminal:**

```bash
npm run wp-dev -- init
```

Important fields:

| Field | Meaning |
|-------|---------|
| `host` | SSH hostname from your hoster (often **not** your public domain on shared hosting) |
| `user` | SSH username |
| `path` | Folder containing `wp-config.php` on the server |
| `url` | Site URL in the remote database (`siteurl` / `home`) |
| `port` | SSH port if not 22 |
| `identityFile` | Path to private key if not `~/.ssh/id_ed25519` |

Use `~/.ssh/your-key` for identityFile (works on the host and in the browser terminal); avoid absolute paths like `/home/you/.ssh/...`.

## Verify SSH setup

For first-time setup, verify against **staging** (no production contact):

```bash
npm run wp-dev -- validate --remote staging
```

This checks SSH connectivity and WordPress path without touching files.

Or use `--local` to check only local settings without SSH:

```bash
npm run wp-dev -- doctor --local
```

For comprehensive checks including rsync dry-run:

```bash
npm run wp-dev -- doctor staging --rsync
```

- `validate --remote`: SSH + WordPress path check only.
- `doctor --rsync`: adds dry-run file sync preview (no writes).

## Key reuse

One key can access many servers. Upload the same `.pub` file to each account that should trust this machine.

## Limitations

WP-dev uses **public-key auth only**. If your host requires a password **after** the key (keyboard-interactive), `ssh` in a terminal may work while `wp-dev pull` does not. Use a key the host accepts without a second prompt.

**Passphrase-protected keys:** If your key has a passphrase, load it with `ssh-add` before running WP-dev commands. The Docker container has no agent forwarding, so passphrase prompts fail silently.

**SSH config aliases:** WP-dev ignores `~/.ssh/config` (uses `-F /dev/null`). Put the real hostname, port, and identity file in `wp-dev.config.json`, not Host aliases.

## Shared hosting tips

SSH hostname is often a cluster name (for example `linux159.unoeuro.com`), not your domain. Path is often `/var/www/yourdomain/public_html` or similar — confirm in the panel and with `pwd` over SSH.

See [Shared hosting guide](../guides/shared-hosting.md).

## Troubleshooting

- [SSH troubleshooting](../troubleshooting/ssh.md)
- [FAQ — How do I connect SSH?](../reference/faq.md)
