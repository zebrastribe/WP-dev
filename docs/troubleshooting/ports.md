# Port troubleshooting

## Port already allocated

**Symptoms:** `up` fails; Docker reports port in use.

**Fix:**

```bash
npm run wp-dev -- down
npm run wp-dev -- up --reclaim-ports
# or
npm run wp-dev -- up --relocate-ports
```

**Verify:** `npm run wp-dev -- services` shows expected ports.

---

## Every up bumps WP_PORT

**Symptoms:** `local.url` port keeps changing.

**Cause:** Another process or clone uses the port; or stale listeners.

**Fix:** `down` in all clones; `up --reclaim-ports`. Ensure `local.url` matches `WP_PORT`.

**Verify:** Run `up` twice — second run should not change port if this stack owns it.

---

## Redirect to old localhost port

**Symptoms:** Site redirects to `localhost:OLD_PORT`.

**Fix:**

```bash
npm run wp-dev -- up
npm run wp-dev -- doctor --local-http
```

Clears stale `home`/`siteurl` and content URLs.

---

## Related

- [Ports guide](../guides/ports.md)
- [Service manager](../features/service-manager.md)
