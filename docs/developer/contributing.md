# Contributing

Thank you for improving WP-dev.

## Before you start

1. Read [Architecture](./architecture.md) and [Project structure](./project-structure.md).
2. Run [Testing](./testing.md) locally before opening a PR.

## Development setup

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run setup
npm run wp-dev -- up
```

## Making changes

1. Create a branch from `main`.
2. Keep changes focused — one logical improvement per commit when possible.
3. Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, etc.
4. Update documentation when behavior changes (see [Maintenance](./maintenance.md)).
5. Run the release gate:

```bash
npm run release:gate
```

## Documentation

- User docs: `docs/`
- README: quick start only — move depth to `docs/`
- Style: [Documentation style guide](./style-guide.md)

## Admin UI

```bash
npm run admin:dev      # hot reload
npm run admin:build:wp # production build into wordpress/admin/
```

See [docs/admin/README.md](../admin/README.md).

## Pull requests

- Describe what changed and why.
- Note test commands run.
- Link related issues if any.

## Code of conduct

Be respectful and constructive. Report concerns via GitHub Issues.

## Related

- [Testing](./testing.md)
- [Release and CI](./release.md)
