# Release and CI

## Release gate

Local validation matching CI:

```bash
npm run release:gate
```

Steps: prereqs, unit tests, coverage, build, smoke tests, PHP lint (if `php` installed), admin typecheck/build.

## CI workflow

`.github/workflows/ci.yml` on push/PR to `main`:

- Node 22, PHP 8.2
- `npm ci`
- `npm run release:gate`

## Versioning

Package version in `package.json` (`0.1.0` at time of writing). Users update via `git pull` + `wp-dev update`, not npm publish.

## Releasing documentation

Documentation ships with the repo. Update `docs/` in the same PR as feature changes.

## Related

- [Testing](./testing.md)
- [Update guide](../getting-started/update.md)
