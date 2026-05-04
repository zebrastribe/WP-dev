# wp-dev

**What it is:** run **WordPress locally in Docker** (MySQL + Apache), then **`pull`** / **`push`** the **database and files** to or from **staging** and **production** over **SSH** (rsync + WP-CLI on the server).

**What it is not:** it does **not** host staging or production for you. Entries like **`staging.url`** in config are **only** for sync and search-replace — a hostname like **`staging.example.com`** does nothing until **you** have DNS and a server there.

---

## Requirements

| | |
|--|--|
| **Node.js** | 20+ |
| **Docker** | Engine + **Compose v2** (`docker compose`) |
| **For `pull` / `push`** | Remote machine with **SSH**, **rsync**, **WP-CLI** on the WordPress root you configure |

`wp-dev` does **not** create SSH keys for you. You need a keypair and access on the server (see [SSH keypair](#ssh-keypair-not-created-by-wp-dev)).

**Optional:** [Simply.com](https://www.simply.com/en/docs/api/) API — `simply.account` in config + **`WPDEV_SIMPLY_API_KEY`** in the environment — for DNS helpers (`wp-dev simply …`). See [Simply.com staging DNS](#simplycom-staging-dns-api).

---

## Quick start

**Goal:** clone → install → start Docker → set **`wp-dev.config.json`** → open WordPress in the browser.

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run setup          # Docker check, npm install, build CLI + admin UI into wordpress/admin/
```

1. **`wp-dev up`** — starts MySQL + WordPress + WP-CLI service.  
2. **Configure** — either:
   - **Browser:** open **`http://localhost:<WP_PORT>/admin/`** (default port **`8888`** — set **`WP_PORT`** in **`docker/.env`**, copy from **`docker/.env.example`**). Use the **Setup wizard** → **Save** writes **`wp-dev.config.json`**.  
   - **Terminal:** **`wp-dev init`** (interactive).  
3. **Open the site** — URL is **`local.url`** in **`wp-dev.config.json`** (example: **`http://localhost:8888`**). Finish the WordPress installer if this is a new DB.

**`npm run setup` does not run `pull`.** It only prepares the tool and the admin build.

**After you change admin UI code** under **`docs/admin/`**, rebuild: **`npm run admin:build:wp`** (or **`npm run setup`** again).

---

## Choose your workflow

### A — New local site only (no remote yet)

1. Quick start above.  
2. Configure **`project`**, **`local.url`**, and production (staging can stay placeholder).  
3. Use **`wp-dev push`** when you have a real server and SSH details.

### B — Copy an existing site from staging / production

1. Quick start above.  
2. **SSH key** on the server or in the hoster’s panel — [SSH keypair](#ssh-keypair-not-created-by-wp-dev).  
3. **`wp-dev init`** (or edit **`wp-dev.config.json`**): **SSH host** (often *not* the public domain on shared hosting), **user**, remote WordPress **`path`**, **`production.url`** (must match remote **`siteurl`** / **`home`** — [Remote `url` and search-replace](#remote-url-and-search-replace)).  
4. **`wp-dev up`**. If a previous **`pull`** failed with permissions under **`wordpress/`**, run **`wp-dev fix-permissions`** once.  
5. Optional: **`wp-dev doctor`** or **`wp-dev doctor production --rsync`** before the first real sync.  
6. **`wp-dev pull production`** (or **`pull staging`** if you use a real staging server — [Staging vs local](#staging-vs-local)).

**First `pull` on messy shared hosting** (paths, prefix, MySQL): use [First pull checklist](#first-pull-checklist-shared-hosting).

---

## Browser admin (URLs and rebuild)

| | URL |
|--|-----|
| **WordPress** | **`local.url`** from config (example **`http://localhost:8888`**) |
| **Wizard + docs + config assistant** | **`http://localhost:<WP_PORT>/admin/`** — same host/port as WordPress; **`WP_PORT`** in **`docker/.env`** (default **8888**) |

**Security:** the WordPress container only bind-mounts **`wp-dev.config.json`** and **`logs/`** (not the whole repo). If others can reach your **`WP_PORT`**, set **`WPDEV_ADMIN_SAVE_TOKEN`** in **`docker/.env`** and the same value in the wizard when saving. If **Save** fails with permission denied, **`chmod u+rw wp-dev.config.json`** on the host or use **`wp-dev init`** instead.

**API** (same origin): **`GET/POST …/admin/api.php?action=load|save`**. Details: **`docs/admin/README.md`**.

**Dev with hot reload:** **`npm run admin:dev`** from the repo root (proxies API to Docker).

---

## Repo layout and where to run commands

Always **`cd`** to the **clone root** — the folder that contains **`package.json`** and **`wp-dev.config.json`** — before **`wp-dev …`**.

| Path | Role |
|------|------|
| **`wordpress/`** | Local WordPress files (bind-mounted into Docker) |
| **`docker/`** | **`docker-compose.yml`**, **`docker/.env`** |
| **`docs/admin/`** | Admin UI source; build output goes to **`wordpress/admin/`** |

---

## `project` and Docker Compose

Each **`wp-dev up`** / **`down`** uses **`docker compose -p <id>`** where **`<id>`** comes from **`project`** in **`wp-dev.config.json`** (or **`local.composeProjectName`**). That isolates containers and volumes per clone. Use a **short unique value** per site (e.g. **`stri-be`** for **`stri.be`**). [Compose project name](https://docs.docker.com/compose/how-tos/project-name/).

---

## Staging vs local

- **`local`** = this machine only — **`local.url`** in the browser.  
- **`staging`** / **`production`** in config = **remotes** for **`pull`** / **`push`**. They are **not** created by wp-dev. Placeholder hostnames like **`staging.example.invalid`** are intentional.  
- **Second local WordPress** = another clone (different **`project`**, port, **`local.url`**), not automatic.

---

## Pull, push, backups, and rollback

| Step | Pulls remote? |
|------|----------------|
| **`npm run setup`** | No |
| **`wp-dev init`** | No |
| **`wp-dev up`** | No |
| **`wp-dev pull …`** | **Yes** |

**Typical flow:** **`wp-dev up`** → configure remotes → **`wp-dev pull staging`** or **`pull production`** (files + DB + URL rewrite toward **`local.url`**).

- **`pull`:** if WordPress is **already** installed locally, a **pre-pull** DB dump is written under **`~/.wp-dev/backups/<project>/local/`** before overwrite (skip on first empty install, or use **`--no-backup-local`**).  
- **`push`:** writes a **pre-push** SQL snapshot on the remote before overwriting the server DB (path printed when done).  
- **First-time `push staging` bootstrap:** if no WordPress install exists yet at `staging.path`, wp-dev seeds files only and prints next steps. Finish remote WP install (`/wp-admin/install.php`), then run `push staging` again for DB + search-replace.
- **`wp-dev backup`** / **`wp-dev restore`** — manual DB export/import.  
- **`pull --dry-run`** / **`push --dry-run`** — rsync preview only (no DB steps).

**Rollback:** bad local DB after **`pull`** → **`wp-dev restore local`** with the **`pre-pull-*.sql`** path from the command output (or older files in **`~/.wp-dev/backups/.../local/`**). Bad remote after **`push`** → **`restore`** with **`pre-push-*.sql`**. **Files** and **core** are not snapshotted by wp-dev — use Git and hosting backups.

---

## Updating this tool in your clone

```bash
cd /path/to/WP-dev
git pull
npm install              # if package.json / lockfile changed
npm run build            # CLI
npm ci --prefix docs/admin && npm run build:wp --prefix docs/admin   # admin, if you use /admin/
```

**`npm run setup`** is a safe full refresh after **`git pull`**. Ignored data (**`wp-dev.config.json`**, **`docker/.env`**, **`wordpress/`**, log files) stays on disk.

Quick full refresh (recommended when you use the browser admin and local stack):

```bash
git pull
npm run build
npm run admin:build:wp
npm run wp-dev -- down
npm run wp-dev -- up
```

---

## Common commands

| Command | Purpose |
|---------|---------|
| **`npm run check`** | Docker + Compose available |
| **`npm run setup`** | check → install → build (CLI + admin) |
| **`wp-dev init`** | Interactive **`wp-dev.config.json`** |
| **`wp-dev up`** / **`down`** | Local stack; **`down`** frees **`WP_PORT`** for this clone. Optional **`down --remove-orphans`** cleans leftover containers. After **`up`**, the CLI prints **browser URLs** using **`docker/.env` `WP_PORT`** when it differs from **`local.url`**. |
| **`wp-dev fix-permissions`** | Fix **`wordpress/`** ownership for rsync (host vs `www-data`) |
| **`wp-dev doctor`** | Optional **`staging`** or **`production`** (default: both). SSH + **`wp core is-installed`**; **`--rsync`** = pull dry-run only |
| **`wp-dev pull`** / **`push`** | Sync; **`--dry-run`**, **`pull --no-backup-local`** |
| **`wp-dev backup`** / **`restore`** | DB only |
| **`wp-dev logs`** | Tail **`logs/wp-dev.log`** |
| **`wp-dev simply test`** | Simply API check |
| **`wp-dev simply setup-staging-dns [apex]`** | Staging DNS + config hints ([details](#simplycom-staging-dns-api)) |

**Run the CLI:** **`npx wp-dev …`** or **`node dist/cli.js …`**. If **`Permission denied`** on **`dist/cli.js`**, **`chmod +x dist/cli.js`** or **`npm run wp-dev -- …`**.

For first-time remote bootstrap without manual installer, set remote DB settings:
- **`staging.db.host`**, **`staging.db.name`**, **`staging.db.user`**, **`staging.db.password`**, optional **`staging.db.prefix`**
- keep staging DB separate from production DB.
- same keys under **`production.db`** only if you also want production bootstrap flows.
Then `push staging` can seed files, create remote `wp-config.php`, import DB, and run search-replace in one flow.

---

## First pull checklist (shared hosting)

| Step | Action |
|------|--------|
| 1 | **`npm run setup`**, **`wp-dev init`** — real SSH **host** / **user** / **`path`** / **`production.url`**. [Staging vs local](#staging-vs-local). |
| 2 | **`wp-dev doctor`** — probe remotes; add **`--rsync`** for pull dry-run only. |
| 3 | **`wp-dev up`**, open **`local.url`**. |
| 4 | If **`pull`** → **`mkstemp` Permission denied** on **`wordpress/`** → **`wp-dev fix-permissions`**. |
| 5 | **`wp-dev pull production`** (or staging). |
| 6 | If **`pull`** warns about **table prefix** → **`WORDPRESS_TABLE_PREFIX`** in **`docker/.env`**, then **`wp-dev down && wp-dev up`**. |

**Production-only:** **`wp-dev doctor production`**.

---

## SSH keypair (not created by wp-dev)

1. **`ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "you@host"`**  
2. **VPS:** append **`~/.ssh/id_ed25519.pub`** to **`~/.ssh/authorized_keys`** for that user.  
3. **Shared hosting:** upload the public key in the **control panel** (SSH / SFTP section).  
4. Test: **`ssh -i ~/.ssh/id_ed25519 user@host`** with the same **host** and **user** as in config.  
5. In **`wp-dev init`**, set **`identityFile`** if not using the default key.

**Limit:** **`wp-dev`** uses **public-key auth only** (no stored password). If the provider needs a **second** interactive password step after the key, **`ssh`** in a normal terminal may work while **`wp-dev pull`** does not — see [SSH: key-only](#ssh-key-only-no-password-in-config).

---

## Simply.com staging DNS (API)

With **`simply.account`** (for example **`S123456`** or **`UE12345`**) + **`WPDEV_SIMPLY_API_KEY`**, **`wp-dev`** can read the Simply product, suggest an IPv4, and **`POST`** an **A** record for **`staging.<apex>`** (default label **`staging`**) when there is no conflict. **`--keep-existing-dns`** / **`--staging-label`** adjust behavior. It does **not** create hosting, SSL, or WordPress on the server — you still use **`pull`** / **`push`** for files and DB.

---

## Shared hosting (Simply, UnoEuro-style)

**`wp-dev init`** guesses often fit **VPS** layouts, not **shared** clusters.

| Topic | Typical reality |
|--------|------------------|
| **SSH hostname** | **Cluster name** from the panel (e.g. **`linux159.unoeuro.com`**), not always your domain. |
| **SSH user** | Often the **account or domain** string, not **`deploy`**. |
| **`path`** | Often **`/var/www/<domain>/public_html`** or **`/customers/.../httpd.www`** — confirm in the panel and with **`pwd`** / **`ls wp-config.php`** over SSH. |
| **`production.url`** | Must match **`siteurl`** / **`home`** in the DB (**`www`** vs bare domain, **`http`** vs **`https`**). |

Leave the domain guess empty in **`init`** and fill SSH fields manually when in doubt.

---

## Remote `url` and search-replace

**`staging.url`** / **`production.url`** drive **`wp search-replace`** during **`pull`** / **`push`**. They must match what the **remote database** stores for **`siteurl`** and **`home`**.

Extra replaces after **`pull`** (same Compose project as **`wp-dev`**):

```bash
cd docker
docker compose -p <project-from-wp-dev.config.json> -f docker-compose.yml run --rm -T wpcli wp search-replace 'https://www.example.com' 'http://localhost:8888' --skip-columns=guid --path=/var/www/html
```

Use the same **`-p`** value as **`project`** in config. Adjust URLs and **`--path`**.

---

## SSH: key-only (no password in config)

Connections use **node-ssh** with **public-key** auth only. There is **no** password field in **`wp-dev.config.json`**. If the host requires keyboard-interactive or a second password after the key, use a key the host accepts without that step, or sync manually with your normal **`ssh`** session.

---

## Technical notes

### Docker: MySQL 8, `wordpress:cli`, and DB readiness

Compose sets **`mysql_native_password`** so **`wordpress:cli`** can **`wp db import`**. **`db`** has a **healthcheck**; **`pull`** / **`restore`** retry until MySQL answers. Old **`db_data`** volumes may need a one-time user auth migration or volume reset — see [MySQL 8 caching_sha2_password](https://dev.mysql.com/doc/refman/8.0/en/caching-sha2-pluggable-authentication.html).

### `pull` does not sync `wp-config.php` (table prefix)

Rsync **excludes** **`wp-config.php`**. Set **`WORDPRESS_TABLE_PREFIX`** in **`docker/.env`** to match the **imported** tables if not **`wp_`**. **`wp-dev down && wp-dev up`** after changing it.

### WordPress directory ownership vs `pull`

Docker often creates files as **`www-data` (uid 33)** while host **`rsync`** runs as **you** → **`mkstemp` Permission denied`**. Run **`wp-dev fix-permissions`** to **`chown`** the bind-mounted tree to your uid on the host.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| **`npx wp-dev` Permission denied** | **`chmod +x dist/cli.js`** or **`npm run build`** (postbuild fixes execute bit). |
| **Port 8888 in use** | **`docker/.env`** → **`WP_PORT`**, and match **`local.url`**. |
| **No `wp-dev.config.json`** | **`npm install`** (postinstall copies example) or copy **`wp-dev.config.example.json`**. |
| **SSH / rsync fails** | **`path`** = WordPress root (**`wp-config.php`** there), **`wp`** works on server, **`ssh user@host`** works. |
| **`Permission denied (publickey)`** | Wrong user/host, key not in panel, or wrong **`identityFile`**. |
| **`Authenticated with partial success`** | Server wants another auth step — [SSH: key-only](#ssh-key-only-no-password-in-config). |
| **rsync path errors** | Wrong **`path`** or unreadable tree — verify on server. |
| **Empty SQL dump after `pull`** | WP-CLI / **`path`** / permissions — check **`logs/wp-dev.log`**. |
| **Wrong links after `pull`** | Fix **`production.url`** / **`staging.url`**; extra **`wp search-replace`** — [Remote `url`](#remote-url-and-search-replace). |
| **`mkstemp` under `wordpress/`** | **`wp-dev fix-permissions`**. |
| **`caching_sha2_password` on import** | Use shipped Compose **`mysql_native_password`**; fix old DB user or volume. |
| **Can't connect to `db` right after `up`** | Wait for healthy **`db`** or retry **`pull`**. |

---

## Logging

- **`logs/wp-dev.log`** next to **`wp-dev.config.json`** — **`wp-dev logs`**.  
- **Admin wizard:** in-app **Activity log** + browser console; **`logs/wp-dev-admin-api.log`** for **`api.php`** lines (no full JSON body in log).

---

## Tests and CI

```bash
npm test
```

CI on **`main`**: **`npm run check`**, **`npm ci`**, **`npm test`**, **`npm run build`**, admin typecheck + build, **`php -l`** on admin PHP.

---

## Public repo / safety

**Gitignored:** **`wp-dev.config.json`**, **`docker/.env`**, **`wordpress/*`**, log files under **`logs/`** (with **`logs/.gitkeep`** tracked). **Template:** **`wp-dev.config.example.json`**.

Design notes: **`purpose/dev-envmd`**.
