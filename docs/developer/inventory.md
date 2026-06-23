# Documentation inventory

Audit date: 2026-06-23. Canonical home for each topic after the documentation overhaul.

## User documentation (`docs/`)

| Path | Topic | Status |
|------|-------|--------|
| `docs/README.md` | Documentation index | **New — canonical nav** |
| `docs/getting-started/installation.md` | Install | **New** (was README § Requirements/Quick start) |
| `docs/getting-started/first-project.md` | First project | **New** (was README § Quick start/workflows) |
| `docs/getting-started/ssh.md` | SSH keys | **New** (was README § SSH keypair) |
| `docs/getting-started/update.md` | Update tool | **New** (was README § Updating) |
| `docs/guides/syncing.md` | Pull/push | **New** (was README § Pull, push) |
| `docs/guides/backups.md` | Backups | **New** (was README § Rollback) |
| `docs/guides/environments.md` | local/staging/production | **New** (was README § Staging vs local) |
| `docs/guides/permissions.md` | Ownership | **New** (was README § Technical notes) |
| `docs/guides/ports.md` | Ports | **New** (was README troubleshooting ports) |
| `docs/guides/browser-admin.md` | Wizard | **New** (was README § Browser admin) |
| `docs/guides/theme-deploy.md` | Theme push | **New** (was README § Theme-only) |
| `docs/guides/shared-hosting.md` | Shared hosting | **New** (was README § Shared hosting) |
| `docs/features/service-manager.md` | Supervisor | **New** |
| `docs/features/filesystem-manager.md` | FS manager | **New** |
| `docs/features/sync-rules.md` | Sync exclusions | **New** (was README + sync section) |
| `docs/troubleshooting/*` | Problems | **New** (was README § Troubleshooting) |
| `docs/reference/commands.md` | CLI reference | **New** (was README § Common commands) |
| `docs/reference/configuration.md` | Config schema | **New** |
| `docs/reference/environment-variables.md` | docker/.env | **New** |
| `docs/reference/faq.md` | FAQ | **New** |

## Developer documentation

| Path | Topic |
|------|-------|
| `docs/developer/architecture.md` | System design |
| `docs/developer/project-structure.md` | Repo layout |
| `docs/developer/contributing.md` | How to contribute |
| `docs/developer/testing.md` | Test commands |
| `docs/developer/release.md` | CI / release gate |
| `docs/developer/style-guide.md` | Writing rules |
| `docs/developer/maintenance.md` | Doc upkeep |
| `docs/developer/inventory.md` | This file |

## Kept in place (specialized)

| Path | Notes |
|------|-------|
| `docs/admin/README.md` | Admin UI API — developer audience |
| `docs/theme-deploy-for-all-users.md` | Maintainer theme guide — linked from guides |
| `docs/rfc/theme-only-deploy-workflow.md` | RFC — historical |
| `docs/prompts/*` | Internal prompts — not user docs |
| `tests/README.md` | Test layout for contributors |
| `local-commands.example.md` | Private snippet template — not manual |

## Internal / design (`purpose/`)

Not end-user documentation. Referenced from developer architecture only.

## Root files

| File | Role after overhaul |
|------|---------------------|
| `README.md` | **Quick start only** — rewritten |
| `CONTRIBUTING.md` | Pointer to `docs/developer/contributing.md` |

## Removed / avoided duplication

- README sections moved to `docs/` — not duplicated in full.
- Obsolete `chmod 666/777` admin instructions → filesystem manager docs.
- Duplicate command tables → single `docs/reference/commands.md`.

## Gaps / future work

- [ ] `docs/assets/` screenshots for wizard steps
- [ ] GitHub issue/PR templates
- [ ] `SECURITY.md` policy file
- [ ] `CHANGELOG.md` for releases
- [ ] Automated markdown link check in CI
- [ ] Playwright E2E doc for wizard flow

## CLI as documentation source

Command names and flags: verify with `npm run wp-dev -- --help`. Smoke tests in `tests/smoke/` catch registration regressions.
