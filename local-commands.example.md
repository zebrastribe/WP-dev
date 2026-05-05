<<<<<<< HEAD
# Local Command Shortcuts (Example)

Copy this file to `local-commands.md` and customize locally:

```bash
cp local-commands.example.md local-commands.md
```
=======
# Common Commands
>>>>>>> 43cecd0 (Improve admin wizard UX and add common command shortcuts.)

## Full refresh

```bash
git pull &&
npm run build &&
npm run admin:build:wp &&
npm run build --prefix docs/admin &&
npm run wp-dev -- down &&
npm run wp-dev -- up
```

## Staging doctor

```bash
npm run wp-dev -- doctor staging --http
```

## Production pull flow

```bash
git pull &&
npm run build &&
npm run wp-dev -- doctor production &&
npm run wp-dev -- pull production
```

<<<<<<< HEAD
## Path-specific workflow (example path)
=======
## Path-specific workflow (edit path)
>>>>>>> 43cecd0 (Improve admin wizard UX and add common command shortcuts.)

```bash
cd /path/to/your/WP-dev
npm install &&
npm run build &&
npm run wp-dev -- pull production
```
