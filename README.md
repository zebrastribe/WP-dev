# wp-dev

Local **WordPress in Docker** (MySQL + Apache) plus **`pull`** / **`push`** of files + DB to **staging** / **production** over SSH (rsync + WP-CLI).

**First success (browser-first):** after **`npm run setup`** (includes building **`/admin`** into **`wordpress/admin/`**), run **`wp-dev up`**, then open **`http://localhost:<WP_PORT>/admin/`** (same port as WordPress from **`docker/.env`**) — use the **Setup wizard** to create or edit **`wp-dev.config.json`**, then open **`local.url`** for the WordPress installer (or continue after a **`pull`**).

**Staging / production URLs in config** are **metadata for `pull` / `push`** (SSH host, path, and URL search-replace). They are **not** sites **`wp-dev`** creates: **`staging.<domain>`** will not open in a browser until **you** add DNS and hosting. The example file uses **`.invalid`** hostnames for staging so that is obvious — see [Staging is optional](#staging-is-optional).

---

## What you need

- **Node.js** 20+  
- **Docker** + **Compose v2** (`docker compose`) — checked by **`npm run setup`** and before **`wp-dev up`** / **`down`**  
- **`pull`** / **`push`**: `ssh`, `rsync`, **WP-CLI** on the remote WordPress root  

**SSH keys:** `wp-dev` never runs **`ssh-keygen`**. See [SSH keypair](#ssh-keypair-not-created-by-wp-dev) and the checklists below.

**Simply.com (optional):** [API docs](https://www.simply.com/en/docs/api/) — `simply.account` in **`wp-dev.config.json`** + **`WPDEV_SIMPLY_API_KEY`**. **`wp-dev simply test`** checks the key. **`wp-dev simply setup-staging-dns`** (or the matching **`wp-dev init`** prompt) can add a **DNS A record** for **`staging.<domain>`** and fill **staging** SSH/URL hints from the product — it does **not** create WordPress or hosting; **`pull`** / **`push`** still do the file/DB sync. See [Simply.com staging DNS](#simplycom-staging-dns-api).

---

## Repo layout (nested / monorepo)

- **Always run `wp-dev` from the directory that contains `package.json` and `wp-dev.config.json`** (the **project root**).
- Example: clone into **`stri.be/WP-dev/`** → **`cd stri.be/WP-dev`** for every command, not the parent **`stri.be/`** unless that parent is your clone.
- **WordPress files on disk:** **`wordpress/`** next to `docker/` and `package.json` (bind-mounted into the container).
- **Browser UI (wizard + docs):** build into **`wordpress/admin/`** with **`npm run admin:build:wp`** (after **`npm ci --prefix docs/admin`** once), then open **`http://localhost:<WP_PORT>/admin/`** with the stack running. Dev-only: the WordPress container mounts the **repo root** read-write so **`public/api.php`** can save **`wp-dev.config.json`** — see **`docs/admin/README.md`**. Layout follows common Tailwind admin patterns (inspired by [TailAdmin](https://tailadmin.com/)); it is not the TailAdmin product bundle.

---

## `project` and `docker compose -p`

Every **`wp-dev up`** / **`down`** runs **`docker compose -p <id>`** where **`<id>`** comes from **`project`** in `wp-dev.config.json` (or **`local.composeProjectName`** if set). That names containers and volumes so **two clones do not share the same DB volume**.

Use a **short unique value per clone** (e.g. **`stri-be`** for domain **`stri.be`**). **`wp-dev init`** asks for **`project`** first and can derive **`stri-be`**-style paths from your domain in the same flow—keep **`project`** aligned with that slug if you run multiple sites on one machine.

Docs: [Docker Compose project name](https://docs.docker.com/compose/how-tos/project-name/).

---

## One-time setup

```bash
git clone https://github.com/zebrastribe/WP-dev.git <folder>
cd <folder>    # must contain package.json
npm run setup  # Docker check → npm install → build CLI → build admin (docs/admin → dist + wordpress/admin)
```

**`npm run setup` does not `pull`** anything from a remote. Re-run **`npm run admin:build:wp`** (or full **`npm run setup`**) after changing the admin UI sources under **`docs/admin/`**.

**Security note (Linux):** Compose mounts only **`wp-dev.config.json`** and **`logs/`** at **`/wp-dev-repo/`** inside the **`wordpress`** service (not the whole repo). Use only on trusted dev machines; set **`WPDEV_ADMIN_SAVE_TOKEN`** in **`docker/.env`** when others can reach **`WP_PORT`**, and use the same value in the wizard when saving.

**If save fails with permission denied:** the PHP process runs as **`www-data`** in the container; your host file may be owned by your user — **`chmod u+rw wp-dev.config.json`** on the host, or run **`wp-dev init`** from the terminal instead of the wizard.

---

## Checklist: brand-new site (greenfield, e.g. stri.be)

1. Clone + **`cd`** + **`npm run setup`** (builds CLI + **`/admin`** into **`wordpress/admin/`**).  
2. **`wp-dev up`**.  
3. Open **`http://localhost:<WP_PORT>/admin/`** → **Setup wizard**: enter **`project`**, **`local.url`**, production (and optional staging / Simply), **Save** — **or** use **`wp-dev init`** from the terminal instead.  
4. Open **`local.url`** → finish the **WordPress installer**.  
5. **`pull`**: not used. **`push`** when you are ready to send this site to a server.

---

## Checklist: copy an existing site from staging / production

1. Clone + **`cd`** + **`npm run setup`**.  
2. **[SSH keypair](#ssh-keypair-not-created-by-wp-dev)** (VPS: **`authorized_keys`**; shared hosting: **upload key in the panel**).  
3. **`wp-dev init`** (or hand-edit config): SSH **host** (often **not** the public domain on shared hosting), **user**, remote WordPress **`path`**, **`url`** (must match live **`siteurl`** / **`home`** — see [Remote `url` and search-replace](#remote-url-and-search-replace)), optional **`identityFile`**.  
4. **`wp-dev up`** (local MySQL + WP so **WP-CLI** can import DB). If **`pull`** previously failed on **`wordpress/`** permissions, run **`wp-dev fix-permissions`** once.  
5. Optional: **`wp-dev doctor`** or **`wp-dev doctor production --rsync`** to validate SSH / path / rsync before a full **`pull`** — see [New project checklist](#new-project-checklist-first-pull-shared-hosting).  
6. **`wp-dev pull production`** (or **`pull staging`** only if you have a **real** staging server — see [Staging is optional](#staging-is-optional)) — **this** downloads DB + files and rewrites URLs to **`local.url`**. Before overwriting the local DB, **`pull`** writes **`pre-pull-*.sql`** under **`~/.wp-dev/backups/<project>/local/`** when a local site already exists (see [Happy path, rollback, and updating this repo](#happy-path-rollback-and-updating-this-repo)). Optional: **`pull --dry-run`** first (rsync preview only). Use **`pull --no-backup-local`** to skip that export (e.g. slow disk or automation). If **`pull`** warns about **table prefix**, set **`WORDPRESS_TABLE_PREFIX`** in **`docker/.env`** and restart the stack.

---

## When does `pull` run?

| Step | Pulls remote? |
|------|----------------|
| **`npm run setup`** | No |
| **`wp-dev init`** | No |
| **`wp-dev up`** | No — starts **local** Docker only |
| **`wp-dev pull …`** | **Yes** — explicit command |

---

## Happy path, rollback, and updating this repo

### Happy path (typical)

1. **`wp-dev up`**, configure remotes, then **`wp-dev pull staging`** or **`pull production`** when you want your laptop to match that server (files + DB + URL rewrite to **`local.url`**).
2. **`pull`** (non-dry-run): if WordPress is **already installed locally**, **`wp-dev`** exports the **current local database** to **`~/.wp-dev/backups/<project>/local/pre-pull-*.sql`** *before* rsync and import (same idea as **`push`** saving **`pre-push-*.sql`** on the remote side). On the **first** pull into an empty local site, that step is **skipped** (nothing to back up).
3. **`push`** still writes a **remote** DB snapshot to the same backup tree as **`pre-push-*.sql`** before overwriting the server DB — see the completion line after **`push`**.
4. Any time: **`wp-dev backup <local|staging|production>`** and **`wp-dev restore <env> <file.sql>`** for manual DB copies.

Use **`pull --dry-run`** for an rsync preview only (no DB steps, no local backup).

### Unhappy path (what is / is not covered)

| Need | What to use |
|------|-------------|
| Undo a **bad local DB** after **`pull`** | **`wp-dev restore local`** with the **`pre-pull-*.sql`** path from the last successful pull message, or an older file under **`~/.wp-dev/backups/<project>/local/`**. |
| Undo a **bad remote DB** after **`push`** | **`wp-dev restore …`** with the **`pre-push-*.sql`** path printed when **`push`** finished (or a **`wp-dev backup`** you took earlier). |
| **Files** or **WordPress core** version | Not snapshotted by **`wp-dev`**. Use **Git** for code you ship, **tar/snapshots** or **hosting backups** for trees and core. |

### Updating the tool (`git pull`) in your project folder

The **project folder** is the **clone root**: the directory that contains **`package.json`**, **`wp-dev.config.json`**, and (after **`pull`**) **`wordpress/`**. You do **not** need a separate “tool” checkout to get improvements — update **that** repo:

```bash
cd /path/to/WP-dev          # your clone; same cwd you use for every wp-dev command
git pull                    # e.g. origin main
npm install                 # when dependencies or the lockfile changed
npm run build               # rebuild dist/cli.js (postbuild sets chmod +x)
```

**`git pull` does not remove** ignored site data: **`wp-dev.config.json`**, **`docker/.env`**, **`wordpress/`**, **`logs/`** stay on disk unless you delete them yourself. Merge conflicts only appear on **tracked** files you or a teammate changed (for example **`package.json`**).

If **`package.json`** scripts or prerequisites changed, **`npm run setup`** is a safe full pass (Docker check → install → build) after **`git pull`**.

---

## Staging is optional

**Quick check:** Is there a “staging” address on localhost besides **`local.url`** (often **`http://localhost:8888`**)? **No.** In wp-dev as shipped you have **one** local site: whatever **`local.url`** is. That is your **Docker** WordPress in the browser. There is **no** separate built-in “local staging” hostname (no second local URL like `staging.localhost`).

**`staging`** in **`wp-dev.config.json`** is **not** on your laptop — it is **metadata for a remote machine** (SSH host + path + URL) used only by **`pull staging`** / **`push staging`**. Opening **`staging.stri.be`** (or similar) in a browser only works after **you** set up DNS and hosting for that host on the internet, not because wp-dev added it locally.

A **second** local WordPress (another port, another URL) is **not** created automatically. You would do that yourself (e.g. another clone with its own **`project`**, **`docker/.env`** port, and **`local.url`**).

| Environment | What it is |
|-------------|------------|
| **`local`** | **Docker only** — this machine. Open **`local.url`** (default in the example: **`http://localhost:8888`**). |
| **`staging`** | **Optional remote** — SSH + paths + URL for **`wp-dev pull staging`** / **`push staging`**. Nothing runs until **you** provision a server (or shared-hosting space) and point **`staging.<domain>`** (or whatever host you set) at it in **DNS**. **`wp-dev`** does **not** register DNS, create subdomains, or open ports on the internet. |
| **`production`** | **Remote** — same idea as staging, for **`pull production`** / **`push production`**. |

If you **only have production** (typical on a single shared-hosting site), you can **ignore** the **`staging`** block, leave **placeholder** values (e.g. **`staging.example.invalid`** from **`wp-dev.config.example.json`**), or answer **No** to “staging server” during **`wp-dev init`** so placeholders are written. **Do not** expect **`https://staging.stri.be`** to load unless you configured that hostname at your registrar / panel and installed WordPress there.

Use **`wp-dev doctor`** (and optional **`--rsync`**) before your first **`pull`** to verify SSH, DNS, **`wp core is-installed`**, and rsync paths — see **Commands (reference)** below and [New project checklist](#new-project-checklist-first-pull-shared-hosting).

---

## New project checklist (first `pull`, shared hosting)

Use this when you **mirror an existing site** and hit **paths, keys, permissions, DB auth, or table prefix** friction. **`npm run setup` → `init` → `up` → `pull`** is short when everything matches; this list trims the sharp edges.

| Step | What to do |
|------|------------|
| 1. Base | **`npm run setup`**, **`wp-dev init`** (shared hosting: empty domain prompt; real SSH host, **`user`**, **`path`**, **`production.url`** = remote **`siteurl`/`home`**). [Staging is optional](#staging-is-optional). |
| 2. Probe remotes | **`wp-dev doctor`** — Docker prereq + DNS hint + **`wp core is-installed`** over SSH for **staging** and **production** (staging **`.invalid`** placeholders are **skipped**). Add **`--rsync`** for a **pull-only dry-run** (no DB import, no file writes). |
| 3. Local stack | **`wp-dev up`**, open **`local.url`**. |
| 4. Filesystem | If **`pull`** failed with **`mkstemp` … Permission denied** under **`wordpress/`**, run **`wp-dev fix-permissions`** once before **`pull`**. |
| 5. Pull | **`wp-dev pull production`** (or **`staging`** if configured). **`pull`** already waits for MySQL, uses **`mysql_native_password`** in the shipped Compose, hints **table prefix** after import, and fixes remote **`--path`** quoting — see [Docker: MySQL 8](#docker-mysql-8-wordpresscli-and-db-readiness), [table prefix](#pull-does-not-sync-wp-configphp-table-prefix), [ownership](#wordpress-directory-ownership-vs-pull-rsync). |
| 6. After import | If **`pull`** printed a **table prefix** warning, set **`WORDPRESS_TABLE_PREFIX`** in **`docker/.env`**, then **`wp-dev down && wp-dev up`**. |

**Production-only:** use **`wp-dev doctor production`**; ignore skipped staging.

---

## Running the CLI

Prefer (after **`npm run build`**, **`dist/cli.js`** is **`chmod +x`** via **`postbuild`**):

```bash
npx wp-dev <command>
```

If **`npx`** fails with **Permission denied** on `dist/cli.js`:

```bash
npm run wp-dev -- <command>    # e.g. npm run wp-dev -- up
node dist/cli.js <command>
chmod +x dist/cli.js           # one-off; postbuild does this after build
```

CI runs **`test -x dist/cli.js`** after **`npm run build`** so published builds keep the execute bit.

---

## Docker: MySQL 8, `wordpress:cli`, and DB readiness

The Compose template sets **`mysqld --default-authentication-plugin=mysql_native_password`** so the official **`wordpress:cli`** image can run **`wp db import`** without **`caching_sha2_password`** client plugin errors.

- **New volumes:** recreating the **`db`** container picks this up automatically.  
- **Existing `db_data` volume** created with the old default: you may need to **`ALTER USER`** for the WordPress DB user to **`mysql_native_password`** once (see [MySQL 8 ref](https://dev.mysql.com/doc/refman/8.0/en/caching-sha2-pluggable-authentication.html)), or reset the volume (destroys local DB).  
- **`db`** has a **healthcheck**; **`wordpress`** / **`wpcli`** wait for **`service_healthy`**. **`pull`** / **`restore`** also **retry** until **`mysqladmin ping`** succeeds before **`wp db import`**, which avoids transient **Can’t connect to MySQL server on `db`** right after **`docker compose up`**.

---

## `pull` does not sync `wp-config.php` (table prefix)

**Rsync excludes `wp-config.php`** so local DB credentials are not overwritten. The **table prefix** in the imported SQL must match what the **local** WordPress config expects.

- Set **`WORDPRESS_TABLE_PREFIX`** in **`docker/.env`** (see **`docker/.env.example`**) to the remote site’s prefix (often **`wp_`**; sometimes a host-generated prefix).  
- After **`pull`**, if the prefix is not **`wp_`**, **`wp-dev`** prints a reminder. Then **`wp-dev down && wp-dev up`** (or restart) so **`wordpress`** / **`wpcli`** pick up the env var.

---

## WordPress directory ownership vs pull (rsync)

Files created **inside Docker** are often **`www-data` (uid 33)** on the bind-mounted **`wordpress/`**, while **`rsync`** on the host runs as **your user** → **`mkstemp … Permission denied`**.

- **Before** (or after) **`pull`**, align ownership once: **`wp-dev fix-permissions`** runs **`chown -R <your uid>:<gid>`** on **`/var/www/html`** in the **`wordpress`** container (root), so the host tree is writable.  
- If Apache then cannot write uploads, you can **`chown`** back to **`www-data`** inside the container for normal operation — same pattern, reverse uid.

---

## Commands (reference)

| Command | Purpose |
|---------|---------|
| `npm run check` | Docker + Compose only |
| `npm run setup` | check → install → build (+ default config) |
| `wp-dev init` | Interactive **`wp-dev.config.json`** |
| `wp-dev up` / `down` | Local stack |
| `wp-dev fix-permissions` | **`chown`** bind-mounted **`wordpress/`** to your host user (helps **`pull`** / **`rsync`**) |
| `wp-dev doctor [env]` | Optional **`staging`** or **`production`** (default: both). Docker prereq + DNS + SSH + **`wp core is-installed`**; **`--rsync`** = **`rsync` pull dry-run** only (no DB) |
| `wp-dev pull` / `push` | Sync env; **`pull`** defaults to a **local pre-pull DB** dump when WP is installed locally (**`--no-backup-local`** to skip); **`--dry-run`** = rsync preview only |
| `wp-dev backup` / `restore` | DB only |
| `wp-dev logs` | **`logs/wp-dev.log`** |
| `wp-dev simply test` | [Simply.com API](https://www.simply.com/en/docs/api/) check (**`GET /my/products/`**) |
| `wp-dev simply setup-staging-dns [apex]` | Simply: **A** **`<label>.<domain>`** (default label **`staging`**) + update **`staging`** in config; **`--keep-existing-dns`** / **`--staging-label`** on conflict (see [Simply.com staging DNS](#simplycom-staging-dns-api)) |

---

## SSH keypair (not created by wp-dev)

Before first **`pull`** / **`push`**:

1. **`ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "you@host"`**  
2. **VPS / own server:** append **`~/.ssh/id_ed25519.pub`** to the SSH user’s **`~/.ssh/authorized_keys`** on the host you connect to.  
3. **Shared hosting (Simply, UnoEuro, …):** the provider often expects you to **upload the public key in the control panel** (“SSH access”, “FTP/SSH”, or similar) instead of editing **`authorized_keys`** yourself. Until the key is registered, **`ssh`** will fail with **`Permission denied (publickey)`**.  
4. **`ssh -i ~/.ssh/id_ed25519 user@host`** to test (use the **same host and username** you will put in **`wp-dev.config.json`**).  
5. In **`wp-dev init`**, leave identity empty **or** set **`~/.ssh/id_ed25519`**.

---

## Simply.com staging DNS (API)

With **`simply.account`** in **`wp-dev.config.json`** and **`WPDEV_SIMPLY_API_KEY`** in the environment, **`wp-dev`** can call [Simply’s REST API](https://www.simply.com/en/docs/api/) to:

1. **`GET /my/products/`** — find the product whose **`domain.name`** (or **`object`**) matches your apex domain (e.g. **`stri.be`**).
2. **`GET …/dns/records/`** — read the zone; pick an IPv4 from **webserver / sshserver** metadata on the product when present, otherwise from an existing **A** record for the apex or **`www`** hostname.
3. **`POST …/dns/records/`** — create **`<label>.<apex>` → A → that IPv4** (default label **`staging`**) only when that hostname has **no** conflicting record. If **Simply already has** an **A** to another IP, or a **CNAME** (etc.) at that name, **`wp-dev` does not overwrite** it.

**If there is a conflict:** **`wp-dev init`** asks whether to **keep the existing DNS** and only update **`staging.url`** / hints in config, or to use an **alternate label** (e.g. **`dev`** → **`dev.<apex>`**). The CLI can do the same non-interactively: **`--keep-existing-dns`** (config only) or **`--staging-label dev`** (create/use another name).

**`wp-dev init`** may offer this **after** you save the Simply account, if the API key is set and an apex is known (main domain prompt, or hostname from **`production.url`**). **`wp-dev simply setup-staging-dns [apex]`** does the same without re-running all of **`init`**, then **writes** updated **`staging`** fields to **`wp-dev.config.json`** (URL, and placeholder **host** / **path** / **user** hints from the product when applicable).

**Not included:** creating hosting, vhosts, or WordPress on the server; changing nameservers; SSL certificates. You still install or copy the site on the host, then use **`pull`** / **`push`** as usual.

---

## Shared hosting (Simply.com, UnoEuro-style)

**`wp-dev init`** domain guesses use **`staging.<domain>`**, **`production` = domain**, and **`/var/www/<slug>`** — that matches many **VPS** setups, not typical **shared** clusters.

| Topic | What to expect |
|--------|------------------|
| **SSH hostname** | Often a **cluster name** (e.g. **`linux159.unoeuro.com`**) from the hoster’s panel or docs — **not** necessarily **`stri.be`**. |
| **SSH username** | Frequently the **account or domain** (e.g. **`stri.be`**) rather than **`deploy`**. |
| **WordPress root `path`** | Often **`/var/www/<domain>/public_html`** (UnoEuro / Simply-style) — **not** the **`/var/www/<slug>`** guess from **`wp-dev init`**. Other accounts use paths like **`/customers/<domain>/httpd.www`**. **Verify in the panel**, then SSH once: **`pwd`**, **`ls -la wp-config.php`**. Wrong **`path`** breaks **rsync** and **WP-CLI**. |
| **Public URL `staging.url` / `production.url`** | Must match how WordPress is configured (**`siteurl`** / **`home`**) including **`www`** vs bare domain (**`https://www.stri.be`** vs **`https://stri.be`**). Wrong values break **links after `pull`** (search-replace). |

**Init:** leave the “main site domain” prompt **empty** and fill **staging** / **production** manually, or answer **No** when asked to use guessed hosts/paths.

**Optional templates (no secrets):** keep a snippet with placeholders, e.g. **`host`:** **`linuxNNN.unoeuro.com`**, **`user`:** **`<your-domain>`**, **`path`:** **`/var/www/<your-domain>/public_html`** (or **`/customers/.../httpd.www`** per panel), then fill from the provider UI.

---

## Remote `url` and search-replace

**`staging.url`** and **`production.url`** are used when **`pull`** / **`push`** rewrite URLs in the database. They must match what is **stored in the DB** for **`siteurl`** and **`home`** on that environment (often the same as **Settings → General**, or **`wp option get siteurl`** / **`home`** over SSH). **`https://www.example.com`** vs **`https://example.com`** vs **`http://`** are different strings — a mismatch means broken links after import.

If the live site uses several URLs (old domain, **`www`**, mixed **`http`/`https`**), one replace is not always enough. After **`pull`**, run further **`wp search-replace`** using the same Compose project as **`wp-dev`** (see **`project`** in **`wp-dev.config.json`**), from the **`docker/`** directory:

```bash
cd docker
docker compose -p <project-from-wp-dev.config.json> -f docker-compose.yml run --rm -T wpcli wp search-replace 'https://www.example.com' 'http://localhost:8888' --skip-columns=guid --path=/var/www/html
```

Replace **`<project-from-wp-dev.config.json>`** with the same **`-p`** value **`wp-dev`** uses (see **project** and **docker compose -p** above; the id is normalized from **`project`**). Adjust both URLs and **`--path=/var/www/html`**. Prefer **`wp option get siteurl`** / **`home`** on the remote before **`pull`** so **`production.url`** matches the primary stored URL.

---

## SSH: key-only (no password in config)

**`wp-dev`** connects with **node-ssh** using **public-key** auth only (**`tryKeyboard`** is off); there is **no** **`password`** field in **`wp-dev.config.json`**.

Some providers document **SSH as key + webspace/FTP password** (second factor after the key). If **`ssh`** from a normal terminal works but **`wp-dev pull`** still fails after key auth, the host may require **keyboard-interactive** or a password step that **`wp-dev` does not implement**. Workarounds until the tool gains optional password/agent support: use a key the host accepts **without** a follow-up password, or run **manual `rsync` / `wp db export`** using your usual **`ssh`** session.

---

## Troubleshooting

### `npx wp-dev` → Permission denied

`dist/cli.js` must be executable. After **`npm run build`**, **`postbuild`** sets **`chmod 755`**. If you copied **`dist/`** without permissions or skipped **`postbuild`**, run **`chmod +x dist/cli.js`** or use **`npm run wp-dev -- …`** / **`node dist/cli.js …`**.

### Port 8888 already in use

Copy **`docker/.env.example`** → **`docker/.env`**, set **`WP_PORT=`** to a free port, and set **`local.url`** in **`wp-dev.config.json`** to match (e.g. `http://localhost:8890`).

### No `wp-dev.config.json`

Run **`npm install`** once ( **`postinstall`** copies from **`wp-dev.config.example.json`** ) or copy that example file manually.

### `pull` / `push` fail SSH or rsync

Confirm **WP-CLI** on the server, **`path`** is the WordPress root (where **`wp-config.php`** lives), and **`ssh user@host`** works with the same user/key.

### `Permission denied (publickey)`

Key not accepted: wrong **`user`** / **`host`**, key not uploaded in the **panel** (shared hosting), or **`identityFile`** does not match the key registered with the provider.

### `Authenticated with partial success` / connection drops after key

Often means the server wants **another** authentication step (password, 2FA, or restricted shell). **`wp-dev`** does not drive interactive prompts — see [SSH: key-only](#ssh-key-only-no-password-in-config).

### rsync “No such file or directory” / path errors

**`path`** is wrong (not the directory that contains **`wp-config.php`**), or the SSH user cannot read that tree. Re-check on the server with **`ls`** / **`pwd`**.

### Empty or tiny SQL dump after `pull`

Remote **`wp db export`** failed (WP-CLI missing, wrong **`path`**, or permissions). Check **`logs/wp-dev.log`** and run **`wp db export`** manually over SSH from the same **`path`**.

### Wrong links / redirects after `pull`

Align **`staging.url`** / **`production.url`** with **`siteurl`** / **`home`** on the source site (including **`www`**). Run extra **`wp search-replace`** passes if needed — see [Remote `url` and search-replace](#remote-url-and-search-replace).

### rsync **`mkstemp` … Permission denied** under **`wordpress/`**

Usually **host user** vs **container `www-data` ownership**. Run **`wp-dev fix-permissions`** (see [WordPress directory ownership vs pull](#wordpress-directory-ownership-vs-pull-rsync)).

### **`Plugin caching_sha2_password could not be loaded`** (local **`wp db import`**)

MySQL 8 default auth vs **`wordpress:cli`**. Use the shipped **`docker-compose.yml`** (**`mysql_native_password`**) and/or migrate the DB user on an old volume (see [Docker: MySQL 8](#docker-mysql-8-wordpresscli-and-db-readiness) above).

### **Can’t connect to MySQL server** on **`db`** right after **`up`**

Wait for **`db`** healthy or retry **`pull`**; **`wp-dev`** waits before import, but a very slow first start can still time out — check **`docker compose ps`** and logs.

---

## Logging

**`logs/wp-dev.log`** (gitignored) next to **`wp-dev.config.json`**. **`wp-dev logs`** prints path + tail.

**Browser admin / wizard:** the in-app **Activity log** (and browser **Console**) record wizard and API steps. **`logs/wp-dev-admin-api.log`** (same **`logs/`** folder, gitignored with **`logs/*`**) receives one line per **`/admin/api.php`** request (method, result, project id on successful save — not the full JSON body).

---

## Tests & CI

```bash
npm test
```

CI: **`npm run check`**, **`npm ci`**, **`npm test`**, **`npm run build`** on **`main`**.

---

## Public repo / safety

Gitignored: **`wp-dev.config.json`**, **`docker/.env`**, **`wordpress/*`**, **`logs/`**. Template: **`wp-dev.config.example.json`**.

Design notes: **`purpose/dev-envmd`**.
