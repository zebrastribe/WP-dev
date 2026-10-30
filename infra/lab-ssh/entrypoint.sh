#!/bin/sh
set -eu

# Ensure lab can write the shared WordPress tree (apache www-data owns it).
chown -R lab:lab /var/www/html 2>/dev/null || true
chmod -R u+rwX /var/www/html 2>/dev/null || true

# authorized_keys mount may be root:root mode 644 from the host — sshd is fine with that.
if [ ! -f /etc/ssh/authorized_keys/lab ]; then
  echo "lab-ssh: missing /etc/ssh/authorized_keys/lab (run infra/lab-up.sh first)" >&2
  exit 1
fi

# Official wordpress image uses getenv_docker() for DB_* — CLI/SSH must see the same env.
{
  echo "export WORDPRESS_DB_HOST=${WORDPRESS_DB_HOST:-db}"
  echo "export WORDPRESS_DB_USER=${WORDPRESS_DB_USER:-wordpress}"
  echo "export WORDPRESS_DB_PASSWORD=${WORDPRESS_DB_PASSWORD:-wordpress}"
  echo "export WORDPRESS_DB_NAME=${WORDPRESS_DB_NAME:-wordpress}"
} >/home/lab/.wpdev-lab-env
chown lab:lab /home/lab/.wpdev-lab-env
# Cover login and non-login shells (SSH often skips .bashrc unless interactive).
for f in /home/lab/.profile /home/lab/.bash_profile /home/lab/.bashrc; do
  touch "$f"
  grep -q wpdev-lab-env "$f" 2>/dev/null || \
    echo '[ -f "$HOME/.wpdev-lab-env" ] && . "$HOME/.wpdev-lab-env"' >>"$f"
  chown lab:lab "$f"
done

exec /usr/sbin/sshd -D -e
