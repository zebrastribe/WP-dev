# Documentation style guide

## Voice

- **Clear and direct** — 8th-grade reading level for getting-started and guides.
- **Second person** — “you”, not “the user”.
- **Present tense** — “WP-dev starts Docker”, not “will start”.
- Avoid jargon; define terms once (SSH, rsync, Docker).

## Terminology (canonical)

| Use | Not |
|-----|-----|
| WP-dev | wpdev, WP Dev, Wp-Dev |
| `wp-dev` | wp_dev (in commands use backticks) |
| `wp-dev.config.json` | config file, JSON config (after first mention) |
| `docker/.env` | .env file |
| staging / production | Staging / Production (in prose) |
| pull / push | Pull / Push (in prose) |

## Command examples

- Always from repo root.
- Use `npm run wp-dev -- <command>` in docs (works without global install).
- Verify commands against `npm run wp-dev -- --help` before publishing.
- One command per block when possible; add comments only when necessary.

## Structure

- One page = one topic.
- Start with what the page answers in the first paragraph.
- Use tables for reference material.
- Link to canonical pages — do not duplicate long explanations.

## Headings

- One `#` per page (title).
- Use `##` and `###` — do not skip levels.

## Links

- Internal: relative paths (`../guides/syncing.md`).
- External: full URLs with descriptive text.

## Where content belongs

| Content | Location |
|---------|----------|
| 5-minute install | README |
| SSH deep dive | `docs/getting-started/ssh.md` |
| All commands | `docs/reference/commands.md` |
| Troubleshooting | `docs/troubleshooting/` |
| Architecture | `docs/developer/` |

## Callouts

Use blockquotes for tips:

> **Tip:** Copy `WPDEV_ADMIN_SAVE_TOKEN` from `docker/.env`.

## Screenshots

Place in `docs/assets/` when added. Use alt text. Prefer ASCII diagrams for CLI-only flows.

## Related

- [Documentation maintenance](./maintenance.md)
