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

# New data comes only from the Blizzard API: nothing here fetches TradeSkillMaster, AHledger or any other service.
# The history before 18 Nov 2026 (early/, early-h/) is a finished, static part of Goblin Ledger's own series.

# Market indexes: an extra that must never stop the price collection.
node "$ROOT/collector/indexes.ts" "$DATA_DIR" || echo "indexes failed (prices still published)"
# Weekly recap (after the indexes, which it reads): an extra too.
node "$ROOT/collector/weekly.ts" "$DATA_DIR" || echo "weekly recap failed (prices still published)"

cd "$DATA_DIR"
cat > README.md <<'EOF'
# Goblin Ledger price data

Published by the Goblin Ledger collector from Blizzard's WoW Forever auction house API, about once an hour.
This branch is replaced on every update. File formats: docs/DATA.md on the main branch.
EOF
printf "state/
" > .gitignore
git add -A
if git rev-parse -q --verify HEAD >/dev/null; then
  git commit -q --amend -m "Goblin Ledger data $(date -u +%Y-%m-%dT%H:%MZ)"
else
  git commit -q -m "Goblin Ledger data $(date -u +%Y-%m-%dT%H:%MZ)"
fi
git push -q -f origin HEAD:data
echo "published $(date -u +%H:%M) UTC"

# Cloudflare R2 copy (what the app reads first, docs/R2_DATA.md): only when R2 is configured, and never a reason to
# fail the run (the GitHub copy above is published either way).
if [ -n "${R2_ACCOUNT_ID:-}" ] || grep -qs '^R2_ACCOUNT_ID=.' "$ROOT/.env"; then
  node --env-file-if-exists="$ROOT/.env" "$ROOT/collector/r2-publish.ts" "$DATA_DIR" || echo "R2 publish failed (GitHub copy published)"
fi
