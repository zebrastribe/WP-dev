# Documentation maintenance

## Principles

1. **One canonical page per topic** — link, don’t copy.
2. **README stays minimal** — quick start only (~250–400 lines).
3. **Docs change with code** — same PR when possible.
4. **Commands stay verifiable** — run `npm run wp-dev -- --help` after CLI changes.

## When to update what

| Change | Update |
|--------|--------|
| New CLI command or flag | `src/cli.ts`, `docs/reference/commands.md`, README if daily-use |
| Config schema | `wp-dev.config.example.json`, `docs/reference/configuration.md` |
| New `docker/.env` variable | `docker/.env.example`, `docs/reference/environment-variables.md` |
| New feature | `docs/features/` or `docs/guides/` + link from `docs/README.md` |
| Bug fix users hit | `docs/troubleshooting/` + regression test |

## Checklist before merge

- [ ] README not bloated with moved content
- [ ] Internal links work (relative paths)
- [ ] Command examples tested
- [ ] FAQ updated if beginners would ask
- [ ] `docs/README.md` index includes new pages

## Recommended tooling

| Tool | Purpose | Status |
|------|---------|--------|
| `markdownlint-cli` | Markdown style | Recommended — not yet in CI |
| `lychee` or `markdown-link-check` | Broken links | Recommended — not yet in CI |
| `npm run wp-dev -- --help` | CLI sync | Manual / smoke tests |
| `npm run release:gate` | Build + tests | In CI |

### Example: local link check (optional)

```bash
npx markdown-link-check docs/**/*.md README.md
```

### Example: markdown lint (optional)

```bash
npx markdownlint-cli docs README.md
```

## Inventory

See [Documentation inventory](./inventory.md) for file list and migration notes.

## Related

- [Style guide](./style-guide.md)
- [Contributing](./contributing.md)
