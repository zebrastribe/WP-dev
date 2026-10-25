# Hosted / multi-tenant web plan — not in this public repo

The detailed hosted / multi-tenant plan lives only in the **private** repository:

**https://github.com/zebrastribe/WP-dev-cloud** → `docs/online-migration-plan.md`

**This public repository** (`zebrastribe/WP-dev`) is the localhost WordPress Dev→Staging→Production CLI (+ optional local `/admin/` UI only).

- Do **not** expose today’s `/admin/` PHP API or Docker runners on the public internet.
- Do **not** publish hosted design, providers, costs, or control-plane internals here.
- Day-to-day use: [README.md](../../README.md), [project-structure.md](./project-structure.md), [architecture.md](./architecture.md).

## Status snapshot (2026-10-25)

| Item | Status |
|------|--------|
| Plan document (private) | **COMPLETE** — see private repo only |
| Public integrity baseline | **Done** on public `main` |
| Forensic audit (localhost) | **Done** — findings registered; repair campaign executed (B0–B5) |
| Repair batches B0–B5 | **Implemented** (working tree; commit when owner requests) — see below |
| Repair batch B6 | **Deferred** — product decisions (file/DB-only sync) + optional Docker hardening |
| SaaS / hosted build hold | **ON** — lift only via explicit owner instruction in the private plan |
| Product launch | **Not ready** — no hosted control plane in this repo |

### Localhost repair campaign (post-audit)

Executed in dependency order after forensic audit. Gates observed: `npm test` 301 pass, `npm run test:smoke` 16 pass, `npm run build` pass.

| Batch | Objective | Status |
|-------|-----------|--------|
| **B0** | Atomic sync lock; host/NS-aware reclaim; token-safe release | Done |
| **BA1** | WordPress: no RW `docker/` mount; no `WPDEV_ADMIN_SAVE_TOKEN` in container env; host modes 775/664/660 | Done |
| **B1** | Remote `/admin` purge only when wp-dev `api.php` marker present | Done |
| **B2** | Table-prefix fail-closed on push + SQL restore | Done |
| **BA2** | Admin API: dotenv `$` escape, HTTP response headers, DB host blocklist, terminal env allowlist | Done |
| **B3** | rsync/`runner-remote-env` `StrictHostKeyChecking=yes`; import push pins SSH before rsync | Done |
| **B4** | Remote dump cleanup in `finally` on pull/push | Done |
| **B5** | Theme push requires `SYNC_PRODUCTION`; `update` takes sync lock on stack restart | Done |
| **B6** | File-only/DB-only sync product; further Docker capability limits | **Deferred** |
| **B7** | Restore files-before-DB + DB rollback; confirm-before-lock; dump validation (F-018/F-032) | Done |
| **B7b** | Local archive restore: host-writable before rsync + reconcileAfterPull (permissions contract) | Done |
| **B7c** | Single `runLocalWordpressFileMutation` envelope for pull / pull-theme / local restore | Done |

**WordPress compatibility:** Single-site installs with standard or custom `$table_prefix` are in scope. **Multisite is unsupported** unless explicitly added later.

**Operator note:** After pulling these changes, recreate the local stack (`wp-dev up` / compose) so WordPress picks up the narrowed bind mounts.

Nothing in this public file authorizes a hosted build or deploy. Follow the private plan when the hold is lifted.
