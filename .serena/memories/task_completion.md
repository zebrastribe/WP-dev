# Task completion checklist

Run before considering a coding task done:

```bash
npm run generate:config-artifacts   # if schema changed
npm run build
npm test
npm run test:coverage
npm run test:smoke
npm run test --prefix docs/admin    # admin validation tests
npm run typecheck --prefix docs/admin
npm run build:wp --prefix docs/admin  # if admin UI touched
php -l docs/admin/public/api.php      # if PHP touched (optional locally)
```

**Full CI equivalent:** `npm ci && npm run check && npm test && npm run test:coverage && npm run build && npm run test:smoke && npm ci --prefix docs/admin && npm run typecheck --prefix docs/admin && npm run test --prefix docs/admin && npm run build:wp --prefix docs/admin`

Coverage baseline: ~57% statements (thresholds in vitest.config.ts: 50% global).