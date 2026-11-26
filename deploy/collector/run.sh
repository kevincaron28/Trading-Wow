#!/usr/bin/env bash
# One collection on the Oracle VM, started by goblin-collector.timer (about :30 and :45 every hour).
#   - updates the collector code from GitHub (GOBLIN_APP_REF, default main), as the GitHub Actions job did;
#   - runs collector/publish.sh, which collects from Blizzard, rebuilds the indexes and the weekly recap, and
#     publishes the data branch (and Cloudflare R2 when configured).
# Secrets come from /etc/goblin-ledger/collector.env (EnvironmentFile in goblin-collector.service) and are never
# printed. A snapshot that is already stored is skipped, so the :45 run only matters when the :30 run failed or
# Blizzard was late.
set -euo pipefail

APP="${GOBLIN_APP_DIR:-/opt/goblin-ledger/app}"
DATA="${GOBLIN_DATA_DIR:-/opt/goblin-ledger/data}"
REF="${GOBLIN_APP_REF:-main}"

: "${BNET_CLIENT_ID:?BNET_CLIENT_ID missing in /etc/goblin-ledger/collector.env}"
: "${BNET_CLIENT_SECRET:?BNET_CLIENT_SECRET missing in /etc/goblin-ledger/collector.env}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN missing in /etc/goblin-ledger/collector.env}"

# Git reads the token from the environment through a one-line credential helper: it is never written to a file
# or a remote URL, and never shown in logs.
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=""
export GIT_CONFIG_KEY_1=credential.helper
export GIT_CONFIG_VALUE_1='!f() { echo username=x-access-token; echo "password=${GITHUB_TOKEN}"; }; f'
export GIT_TERMINAL_PROMPT=0

# Latest collector code.
git -C "$APP" fetch -q origin "$REF"
git -C "$APP" reset -q --hard FETCH_HEAD
echo "collector code $(git -C "$APP" rev-parse --short HEAD) ($REF)"

# Recap card renderer (collector/recap-card.ts): resvg, a small native module (about 5 MB), kept outside the app
# checkout in its own folder and installed once per version (the version pinned in package.json). Without it the
# Discord recaps fall back to text and a plain chart, so a failed install never stops the collection.
RENDER="${GOBLIN_RENDER_DIR:-/opt/goblin-ledger/render}"
RESVG_VERSION="$(node -p "require('$APP/package.json').devDependencies['@resvg/resvg-js']" 2>/dev/null || true)"
if [ -n "$RESVG_VERSION" ] && [ "$(node -p "require('$RENDER/node_modules/@resvg/resvg-js/package.json').version" 2>/dev/null || true)" != "$RESVG_VERSION" ]; then
  mkdir -p "$RENDER"
  [ -f "$RENDER/package.json" ] || echo '{ "private": true }' > "$RENDER/package.json"
  npm install --prefix "$RENDER" --no-audit --no-fund --omit=dev --save-exact "@resvg/resvg-js@$RESVG_VERSION" >/dev/null 2>&1 \
    && echo "card renderer: resvg $RESVG_VERSION installed" \
    || echo "card renderer install failed (recaps are posted without cards)"
fi
export GOBLIN_RENDER_DIR="$RENDER"

git -C "$DATA" config user.name "goldline-collector"
git -C "$DATA" config user.email "goldline-collector@users.noreply.github.com"
# The data checkout is about 600 MB: keep git's packing small for this 1 GB VM (GitHub runners had 7 GB).
git -C "$DATA" config pack.threads 1
git -C "$DATA" config pack.windowMemory 64m
git -C "$DATA" config pack.deltaCacheSize 32m
git -C "$DATA" config core.bigFileThreshold 16m

bash "$APP/collector/publish.sh" "$DATA"
