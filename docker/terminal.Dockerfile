# Pin base image by digest for reproducible builds.
# Override: WPDEV_NODE_IMAGE in docker/.env or pass --build-arg BASE_IMAGE=...
ARG BASE_IMAGE=node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5
FROM ${BASE_IMAGE}

# Build args for version pinning - override via docker-compose build args or CLI.
ARG TTYD_VERSION=1.7.7
ARG DOCKER_CLI_VERSION=27.5.1
ARG DOCKER_COMPOSE_VERSION=2.32.4

# SHA-256 checksums for binary verification.
# IMPORTANT: Empty checksums FAIL the build (fail-closed security).
# Generate with: curl -fsSL <url> | sha256sum
# Checksums verified 2026-10-30 against official releases:
#   ttyd:    https://github.com/tsl0922/ttyd/releases/download/1.7.7/
#   docker:  https://download.docker.com/linux/static/stable/{x86_64,aarch64}/
#   compose: https://github.com/docker/compose/releases/download/v2.32.4/
ARG TTYD_SHA256_X86_64=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55
ARG TTYD_SHA256_AARCH64=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165
ARG DOCKER_CLI_SHA256_X86_64=4f798b3ee1e0140eab5bf30b0edc4e84f4cdb53255a429dc3bbae9524845d640
ARG DOCKER_CLI_SHA256_AARCH64=e6b53725a73763ab3f988c73f8772eaed429754c1a579db5ff11f21990fd1817
ARG DOCKER_COMPOSE_SHA256_X86_64=ed1917fb54db184192ea9d0717bcd59e3662ea79db48bff36d3475516c480a6b
ARG DOCKER_COMPOSE_SHA256_AARCH64=0c4591cf3b1ed039adcd803dbbeddf757375fc08c11245b0154135f838495a2f

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
  && if [ -z "${TTYD_SHA}" ]; then \
       echo "ERROR: ttyd checksum not provided (TTYD_SHA256_* is empty). Checksums are required." >&2; \
       exit 1; \
     fi \
  && echo "${TTYD_SHA}  /tmp/ttyd" | sha256sum -c - || { \
       echo "ERROR: ttyd checksum verification failed. Expected: ${TTYD_SHA}" >&2; \
       exit 1; \
     } \
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
  && if [ -z "${DOCKER_CLI_SHA}" ]; then \
       echo "ERROR: Docker CLI checksum not provided (DOCKER_CLI_SHA256_* is empty). Checksums are required." >&2; \
       exit 1; \
     fi \
  && echo "${DOCKER_CLI_SHA}  /tmp/docker.tgz" | sha256sum -c - || { \
       echo "ERROR: Docker CLI checksum verification failed. Expected: ${DOCKER_CLI_SHA}" >&2; \
       exit 1; \
     } \
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
  && if [ -z "${DOCKER_COMPOSE_SHA}" ]; then \
       echo "ERROR: Docker Compose checksum not provided (DOCKER_COMPOSE_SHA256_* is empty). Checksums are required." >&2; \
       exit 1; \
     fi \
  && echo "${DOCKER_COMPOSE_SHA}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum -c - || { \
       echo "ERROR: Docker Compose checksum verification failed. Expected: ${DOCKER_COMPOSE_SHA}" >&2; \
       exit 1; \
     } \
  && chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose \
  # Create non-root user for ttyd
  && useradd --create-home --uid 10001 --shell /bin/bash wpdev-tty

WORKDIR /workspace

# docker-compose.yml uses `init: true` to reap zombie processes
CMD ["/workspace/docker/start-terminal-services.sh"]
