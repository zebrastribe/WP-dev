# Testing

## Quick commands

```bash
npm test                 # Unit + integration tests
npm run test:smoke       # CLI smoke (requires build)
npm run test:all         # unit + build + smoke + admin tests
npm run test:coverage    # coverage report
npm run release:gate     # full CI mirror
```

## Test layout

| Directory | Purpose |
|-----------|---------|
| `tests/*.test.ts` | Unit and integration tests |
| `tests/smoke/` | Post-build CLI smoke tests |
| `docs/admin/src/*.test.ts` | Admin UI tests |

## Writing tests

- Use Vitest (`describe` / `it` / `expect`).
- Prefer testing pure functions in `src/services/` and `src/utils/`.
- CLI orchestration: smoke tests in `tests/smoke/`.
- Mock SSH/Docker for unit tests; do not require Docker for `npm test`.

## Coverage

Configured in `vitest.config.ts`. Orchestration modules (daemon, startup) are covered by smoke/integration rather than unit coverage thresholds.

## CI

GitHub Actions on `main`: `npm run release:gate`. See [Release](./release.md).

## Related

- [Contributing](./contributing.md)
