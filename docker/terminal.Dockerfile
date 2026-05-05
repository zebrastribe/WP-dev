FROM node:20-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    git \
    openssh-client \
    rsync \
    docker.io \
    docker-compose \
    ca-certificates \
    bash \
  && ARCH="$(dpkg --print-architecture)" \
  && case "${ARCH}" in \
      amd64) TTYD_ARCH="x86_64" ;; \
      arm64) TTYD_ARCH="aarch64" ;; \
      *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac \
  && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${TTYD_ARCH}" \
  && chmod +x /usr/local/bin/ttyd \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && ln -sf /usr/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

CMD ["sh", "-lc", "WD=\"${WPDEV_TERMINAL_WORKDIR:-/workspace}\"; if [ ! -d \"$WD\" ]; then WD=/workspace; fi; (while true; do node /workspace/docker/terminal-runner.mjs >>/tmp/terminal-runner.log 2>&1; sleep 1; done) & ttyd -W -p 7681 -c \"${WPDEV_TERMINAL_AUTH:-wpdev:wpdev}\" -w \"$WD\" bash -lc \"cd \\\"$WD\\\" && exec bash\""]
