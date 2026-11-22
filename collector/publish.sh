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

# Public data is Blizzard API data only. Folders that once held imported third-party history (TradeSkillMaster, AHledger,
# ahprice.com, Auctionator scans, and the history merged from them) are taken off the branch; on a PC checkout they are
# first moved into the private, gitignored folder private-data/ next to this script's repo (never deleted there).
for d in tsm ext early early-h seed audit; do
  if [ -d "$DATA_DIR/$d" ]; then
    if [ -d "$ROOT/private-data" ] && [ ! -e "$ROOT/private-data/$d" ]; then mv "$DATA_DIR/$d" "$ROOT/private-data/$d"; else rm -rf "$DATA_DIR/$d"; fi
  fi
done

# Market indexes: an extra that must never stop the price collection.
node "$ROOT/collector/indexes.ts" "$DATA_DIR" || echo "indexes failed (prices still published)"

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
