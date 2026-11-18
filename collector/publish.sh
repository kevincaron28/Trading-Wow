#!/usr/bin/env bash
# Collect one snapshot into the data branch checkout and publish it as a single force-pushed commit
# (the branch keeps no history of its own: the files hold the price history).
#   collector/publish.sh <data-branch-checkout>
set -euo pipefail
DATA_DIR="${1:?usage: collector/publish.sh <data-branch-checkout>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Start from the newest published data, so two collectors (this PC and GitHub Actions) never undo each other.
if git -C "$DATA_DIR" fetch -q origin data 2>/dev/null; then
  git -C "$DATA_DIR" reset -q --hard FETCH_HEAD
fi

if [ -f "$ROOT/.env" ]; then
  node --env-file="$ROOT/.env" "$ROOT/collector/collect.ts" "$DATA_DIR"
else
  node "$ROOT/collector/collect.ts" "$DATA_DIR"
fi

cd "$DATA_DIR"
cat > README.md <<'EOF'
# Goldline price data

Published by the Goldline collector from Blizzard's WoW Forever auction house API, about once an hour.
This branch is replaced on every update. File formats: docs/DATA.md on the main branch.
EOF
git add -A
if git rev-parse -q --verify HEAD >/dev/null; then
  git commit -q --amend -m "Goldline data $(date -u +%Y-%m-%dT%H:%MZ)"
else
  git commit -q -m "Goldline data $(date -u +%Y-%m-%dT%H:%MZ)"
fi
git push -q -f origin HEAD:data
echo "published $(date -u +%H:%M) UTC"
