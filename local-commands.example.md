# Common Commands

## Full refresh

```bash
git pull --rebase --autostash &&
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
git pull --rebase --autostash &&
npm run build &&
npm run wp-dev -- doctor production &&
npm run wp-dev -- pull production
```

## Path-specific workflow (edit path)

```bash
cd /path/to/your/WP-dev
npm install &&
npm run build &&
npm run wp-dev -- pull production
```

## Commit + push
```bash
git status &&
git commit -am "your message" &&
git push
```

## Commit + push (safer)
```bash
git status &&
git diff &&
git add <file1> <file2> &&
git commit -m "your message mm" &&
git push
```