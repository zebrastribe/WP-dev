FROM node:20-bookworm

# Apt docker.io is too old for modern host daemons (API 1.44+). Install current static CLI for runners.
ARG DOCKER_CLI_VERSION=27.5.1
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
    tini \
  && ARCH="$(dpkg --print-architecture)" \
  && case "${ARCH}" in \
      amd64) TTYD_ARCH="x86_64"; DOCKER_ARCH="x86_64" ;; \
      arm64) TTYD_ARCH="aarch64"; DOCKER_ARCH="aarch64" ;; \
      *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac \
  && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${TTYD_ARCH}" \
  && chmod +x /usr/local/bin/ttyd \
  && curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-${DOCKER_CLI_VERSION}.tgz" \
    | tar -xz -C /tmp \
  && mv /tmp/docker/docker /usr/local/bin/docker \
  && chmod 755 /usr/local/bin/docker \
  && rm -rf /tmp/docker \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
    "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-${DOCKER_ARCH}" \
  && chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose \
  && useradd --create-home --uid 10001 --shell /bin/bash wpdev-tty \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Use tini as init to properly reap zombie child processes
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/workspace/docker/start-terminal-services.sh"]
