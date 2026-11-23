#!/usr/bin/env bash
# Install the Goblin Ledger collector on an Oracle VM (Ubuntu 24.04, x86_64), as root:
#   sudo bash install.sh
# Safe to run again: it never overwrites /etc/goblin-ledger/collector.env and only adds what is missing.
# It does not start collecting until collector.env has its three values (docs/COLLECTOR_VM.md).
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-24.21.0}"
REPO="${GOBLIN_REPO:-https://github.com/kevincaron28/Trading-Wow.git}"
REF="${GOBLIN_APP_REF:-main}"
ROOT=/opt/goblin-ledger
ENV_FILE=/etc/goblin-ledger/collector.env

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash $0"; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "this script installs the x86_64 Node build; adapt NODE arch first"; exit 1; }

echo "== swap"
# The VM has 1 GB of memory and runs PostgreSQL: a swap file keeps a collector peak from ever touching the database.
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-goblin-swap.conf
  sysctl -q -p /etc/sysctl.d/99-goblin-swap.conf
  echo "2 GB swap file added (swappiness 10)"
else
  echo "swap already present: $(swapon --show --noheadings | awk '{print $1, $3}' | tr '\n' ' ')"
fi

echo "== packages"
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git xz-utils ca-certificates curl >/dev/null

echo "== node $NODE_VERSION"
if [ "$(/opt/node/bin/node -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  tmp=$(mktemp -d)
  file="node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${file}" -o "$tmp/$file"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " ${file}\$" SHASUMS256.txt | sha256sum -c --quiet -)
  tar -xJf "$tmp/$file" -C /opt
  ln -sfn "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node
  rm -rf "$tmp"
fi
/opt/node/bin/node -v

echo "== user and folders"
id goblin >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin goblin
install -d -o goblin -g goblin -m 0755 "$ROOT"
install -d -o root -g goblin -m 0750 /etc/goblin-ledger

echo "== code and data"
if [ ! -d "$ROOT/app/.git" ]; then
  sudo -u goblin git clone -q --branch "$REF" "$REPO" "$ROOT/app"
fi
if [ ! -d "$ROOT/data/.git" ]; then
  echo "cloning the data branch (about 600 MB, a few minutes)"
  sudo -u goblin git clone -q --depth 1 --branch data --single-branch "$REPO" "$ROOT/data"
fi
chmod 0755 "$ROOT/app/deploy/collector/run.sh"

echo "== settings"
if [ ! -f "$ENV_FILE" ]; then
  install -o root -g goblin -m 0640 "$ROOT/app/deploy/collector/collector.env.example" "$ENV_FILE"
  echo "created $ENV_FILE: fill in its values (docs/COLLECTOR_VM.md, step 3)"
fi

echo "== systemd"
install -m 0644 "$ROOT/app/deploy/collector/goblin-collector.service" /etc/systemd/system/
install -m 0644 "$ROOT/app/deploy/collector/goblin-collector.timer" /etc/systemd/system/
systemctl daemon-reload

# Only start once the three required values are present (never print them).
missing=0
for key in BNET_CLIENT_ID BNET_CLIENT_SECRET GITHUB_TOKEN; do
  grep -Eq "^${key}=.+" "$ENV_FILE" || { echo "missing in $ENV_FILE: $key"; missing=1; }
done
if [ "$missing" = 0 ]; then
  systemctl enable --now goblin-collector.timer
  echo "timer enabled:"
  systemctl list-timers goblin-collector.timer --no-pager
else
  echo "fill in $ENV_FILE, then run: sudo systemctl enable --now goblin-collector.timer"
fi
