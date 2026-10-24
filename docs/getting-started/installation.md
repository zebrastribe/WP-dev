# Installation

WP-dev runs WordPress on your computer inside Docker. You need Docker, Node.js, and a terminal.

## Requirements

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 20 or newer | `node -v` |
| **Docker** | Engine + Compose v2 | `docker compose version` |
| **Git** | Any recent version | To clone the repo |
| **SSH + rsync** | For pull/push only | Built in on macOS; install on Linux if missing |

**Supported platforms:** Linux, macOS (Intel and Apple Silicon), and **Windows via WSL2**.

On Windows, install [WSL2](https://learn.microsoft.com/windows/wsl/) (Ubuntu recommended) and [Docker Desktop](https://www.docker.com/products/docker-desktop/) with WSL integration. Clone and run wp-dev **inside** the WSL distro on a Linux path (`~/…`), not under `/mnt/c/…`. Native Windows shells (`cmd` / PowerShell) are not supported.

## macOS notes

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and wait until it says **Running**.
2. Keep the project folder under your home directory (for example `~/Projects/WP-dev`). Docker Desktop cannot bind-mount every path.
3. `ssh` and `rsync` are already installed.

## Linux notes

Install Docker Engine and the Compose plugin for your distribution. Example on Debian/Ubuntu:

```bash
# Docker — follow https://docs.docker.com/engine/install/ for your distro
sudo apt install git rsync openssh-client
```

## Windows notes (WSL2)

1. Install [WSL2](https://learn.microsoft.com/windows/wsl/) with Ubuntu (or another Linux distro).
2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and turn on **WSL integration** for that distro.
3. Open the **WSL** terminal (not PowerShell), clone under your Linux home (`~/Projects/WP-dev`), then `npm run setup`.
4. Avoid putting the project on `/mnt/c/...` — Docker bind mounts and permissions are unreliable there.

## Clone and install

From a folder where you keep projects:

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run setup
```

`npm run setup` checks Docker, installs npm packages, builds the CLI, and builds the browser admin into `wordpress/admin/`.

### macOS shortcut

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run quickstart
```

`quickstart` runs `setup`, starts the stack, and prints the setup wizard URL.

## Verify installation

```bash
npm run check          # Docker, Compose, ssh, rsync
npm run wp-dev -- --help
```

## Next steps

- [Your first project](./first-project.md)
- [SSH setup](./ssh.md) (before your first pull)
- [Update WP-dev](./update.md)
