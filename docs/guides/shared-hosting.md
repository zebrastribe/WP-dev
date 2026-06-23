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
