# SSH keys and server access

WP-dev uses **SSH** and **rsync** to copy files and run **WP-CLI** on your server. It does not store passwords — only SSH keys.

## What you need

1. An SSH key on your computer.
2. The **public** key uploaded to your hosting panel or server.
3. SSH host, username, and WordPress path in `wp-dev.config.json`.

## Step 1 — Create a key (one time per computer)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "you@example.com"
```

Press Enter to accept the default passphrase (or set one).

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
- **Shared hosting:** paste into the control panel (SSH / SFTP / SSH keys section).

Never upload the private key (the file **without** `.pub`).

## Step 3 — Test SSH manually

Use the same host and user you will put in config:

```bash
ssh -i ~/.ssh/id_ed25519 user@your-ssh-host.example.com
```

If this works, WP-dev can connect.

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

Optional: `identityFile` if your key is not the default path.

## Verify with doctor

```bash
npm run wp-dev -- doctor production
npm run wp-dev -- doctor production --rsync
```

- First command: SSH + WordPress installed check.
- `--rsync`: dry-run file sync only (no writes).

## Key reuse

One key can access many servers. Upload the same `.pub` file to each account that should trust this machine.

## Limitations

WP-dev uses **public-key auth only**. If your host requires a password **after** the key (keyboard-interactive), `ssh` in a terminal may work while `wp-dev pull` does not. Use a key the host accepts without a second prompt.

## Shared hosting tips

SSH hostname is often a cluster name (for example `linux159.unoeuro.com`), not your domain. Path is often `/var/www/yourdomain/public_html` or similar — confirm in the panel and with `pwd` over SSH.

See [Shared hosting guide](../guides/shared-hosting.md).

## Troubleshooting

- [SSH troubleshooting](../troubleshooting/ssh.md)
- [FAQ — How do I connect SSH?](../reference/faq.md)
