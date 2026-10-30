FROM node:20-bookworm

# Build args for version pinning - override via docker-compose build args or CLI.
# Source of truth: docker/versions.env (for documentation; these must match).
ARG TTYD_VERSION=1.7.7
ARG DOCKER_CLI_VERSION=27.5.1
ARG DOCKER_COMPOSE_VERSION=2.32.4

# SHA-256 checksums for binary verification. Empty = skip verification (dev only).
# Generate with: curl -sL <url> | sha256sum
ARG TTYD_SHA256_X86_64=7be073f0a7aa12f01e85c1e5bc9b27cdaa01e48e4b7dd1b88d59c275e0609883
ARG TTYD_SHA256_AARCH64=3d6d4c8abf85a71b7d87a62aa0fe0f0c5bb90cd4bd2f247c9ae5a68e9bece9b1
ARG DOCKER_CLI_SHA256_X86_64=
ARG DOCKER_CLI_SHA256_AARCH64=
ARG DOCKER_COMPOSE_SHA256_X86_64=
ARG DOCKER_COMPOSE_SHA256_AARCH64=

# Apt docker.io is too old for modern host daemons (API 1.44+). Install current static CLI for runners.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    git \
    openssh-client \
    rsync \
    default-mysql-client \
    ca-certificates \
    bash \
    util-linux \
  && rm -rf /var/lib/apt/lists/*

# Determine architecture and set checksums
RUN ARCH="$(dpkg --print-architecture)" \
  && case "${ARCH}" in \
      amd64) TTYD_ARCH="x86_64"; DOCKER_ARCH="x86_64"; \
             TTYD_SHA="${TTYD_SHA256_X86_64}"; \
             DOCKER_CLI_SHA="${DOCKER_CLI_SHA256_X86_64}"; \
             DOCKER_COMPOSE_SHA="${DOCKER_COMPOSE_SHA256_X86_64}" ;; \
      arm64) TTYD_ARCH="aarch64"; DOCKER_ARCH="aarch64"; \
             TTYD_SHA="${TTYD_SHA256_AARCH64}"; \
             DOCKER_CLI_SHA="${DOCKER_CLI_SHA256_AARCH64}"; \
             DOCKER_COMPOSE_SHA="${DOCKER_COMPOSE_SHA256_AARCH64}" ;; \
      *) echo "ERROR: Unsupported architecture: ${ARCH}" >&2 && exit 1 ;; \
    esac \
  # Download ttyd with retry and checksum verification
  && echo "Downloading ttyd ${TTYD_VERSION} for ${TTYD_ARCH}..." \
  && for i in 1 2 3; do \
       curl -fsSL --retry 3 --retry-delay 2 -o /tmp/ttyd \
         "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${TTYD_ARCH}" \
       && break || { \
         echo "WARNING: ttyd download attempt $i failed, retrying..." >&2; \
         [ $i -eq 3 ] && echo "ERROR: Failed to download ttyd after 3 attempts. Check network/registry." >&2 && exit 1; \
         sleep 5; \
       }; \
     done \
  && if [ -n "${TTYD_SHA}" ]; then \
       echo "${TTYD_SHA}  /tmp/ttyd" | sha256sum -c - || { \
         echo "ERROR: ttyd checksum verification failed. Expected: ${TTYD_SHA}" >&2; \
         exit 1; \
       }; \
     else \
       echo "WARNING: ttyd checksum not provided, skipping verification" >&2; \
     fi \
  && mv /tmp/ttyd /usr/local/bin/ttyd \
  && chmod +x /usr/local/bin/ttyd \
  # Download Docker CLI with retry and checksum verification
  && echo "Downloading Docker CLI ${DOCKER_CLI_VERSION} for ${DOCKER_ARCH}..." \
  && for i in 1 2 3; do \
       curl -fsSL --retry 3 --retry-delay 2 -o /tmp/docker.tgz \
         "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-${DOCKER_CLI_VERSION}.tgz" \
       && break || { \
         echo "WARNING: Docker CLI download attempt $i failed, retrying..." >&2; \
         [ $i -eq 3 ] && echo "ERROR: Failed to download Docker CLI after 3 attempts. Check network/registry." >&2 && exit 1; \
         sleep 5; \
       }; \
     done \
  && if [ -n "${DOCKER_CLI_SHA}" ]; then \
       echo "${DOCKER_CLI_SHA}  /tmp/docker.tgz" | sha256sum -c - || { \
         echo "ERROR: Docker CLI checksum verification failed. Expected: ${DOCKER_CLI_SHA}" >&2; \
         exit 1; \
       }; \
     fi \
  && tar -xzf /tmp/docker.tgz -C /tmp \
  && mv /tmp/docker/docker /usr/local/bin/docker \
  && chmod 755 /usr/local/bin/docker \
  && rm -rf /tmp/docker /tmp/docker.tgz \
  # Download Docker Compose with retry and checksum verification
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && echo "Downloading Docker Compose ${DOCKER_COMPOSE_VERSION} for ${DOCKER_ARCH}..." \
  && for i in 1 2 3; do \
       curl -fsSL --retry 3 --retry-delay 2 -o /usr/local/lib/docker/cli-plugins/docker-compose \
         "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${DOCKER_ARCH}" \
       && break || { \
         echo "WARNING: Docker Compose download attempt $i failed, retrying..." >&2; \
         [ $i -eq 3 ] && echo "ERROR: Failed to download Docker Compose after 3 attempts. Check network/registry." >&2 && exit 1; \
         sleep 5; \
       }; \
     done \
  && if [ -n "${DOCKER_COMPOSE_SHA}" ]; then \
       echo "${DOCKER_COMPOSE_SHA}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum -c - || { \
         echo "ERROR: Docker Compose checksum verification failed. Expected: ${DOCKER_COMPOSE_SHA}" >&2; \
         exit 1; \
       }; \
     fi \
  && chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose \
  # Create non-root user for ttyd
  && useradd --create-home --uid 10001 --shell /bin/bash wpdev-tty

WORKDIR /workspace

# docker-compose.yml uses `init: true` to reap zombie processes
CMD ["/workspace/docker/start-terminal-services.sh"]
