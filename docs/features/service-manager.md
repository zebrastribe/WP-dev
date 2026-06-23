# Service manager

WP-dev’s service manager owns **startup**, **shutdown**, **ports**, and a **service registry** for your local stack.

## What it does

- Validates reserved ports (strict mode by default).
- Writes `logs/service-registry.json` with service health and ports.
- Writes structured events to `logs/lifecycle.jsonl`.
- Holds a project lock at `logs/wp-dev.lock` during `up`.
- Runs a multi-phase shutdown on `down`.

## Commands

```bash
npm run wp-dev -- services
npm run wp-dev -- supervisor status
npm run wp-dev -- doctor --lifecycle
```

## Port options on up

```bash
npm run wp-dev -- up --relocate-ports
npm run wp-dev -- up --reclaim-ports
```

| Flag | When to use |
|------|-------------|
| `--relocate-ports` | Another app uses your ports; allow WP-dev to pick free ones |
| `--reclaim-ports` | Orphaned wp-dev processes still hold ports |

## Sync runner location

The sync runner (for admin one-click actions) runs **inside the terminal Docker container** on port **7683**, not as a host loop.

After updating WP-dev:

```bash
npm run wp-dev -- down
npm run wp-dev -- up
```

## Files

| File | Purpose |
|------|---------|
| `logs/wp-dev.lock` | Project lock |
| `logs/service-registry.json` | Services, ports, shutdown phase |
| `logs/lifecycle.jsonl` | Structured lifecycle log |

## Related

- [Ports guide](../guides/ports.md)
- [Architecture](../developer/architecture.md)
