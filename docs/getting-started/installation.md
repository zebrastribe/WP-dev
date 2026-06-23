# Installation

WP-dev runs WordPress on your computer inside Docker. You need Docker, Node.js, and a terminal.

## Requirements

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 20 or newer | `node -v` |
| **Docker** | Engine + Compose v2 | `docker compose version` |
| **Git** | Any recent version | To clone the repo |
| **SSH + rsync** | For pull/push only | Built in on macOS; install on Linux if missing |

**Supported platforms:** macOS (Intel and Apple Silicon) and Linux.

WP-dev does **not** run natively on Windows. Use WSL2 with Linux, or macOS/Linux.

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
