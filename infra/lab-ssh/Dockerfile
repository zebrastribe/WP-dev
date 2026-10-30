# Lab SSH target: openssh + rsync + wp-cli (PHP) sharing the WordPress volume.
# Key-only auth. Not for production.
FROM debian:bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server \
    rsync \
    curl \
    ca-certificates \
    php-cli \
    php-mysql \
    php-xml \
    php-mbstring \
    php-curl \
    php-zip \
    default-mysql-client \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/run/sshd /etc/ssh/authorized_keys \
  && curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
  && chmod +x /usr/local/bin/wp \
  && useradd -m -d /home/lab -s /bin/bash lab \
  && usermod -p '*' lab \
  && mkdir -p /home/lab/.ssh \
  && chown -R lab:lab /home/lab \
  && ssh-keygen -A

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
