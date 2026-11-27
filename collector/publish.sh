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

# One-time index backfill (docs/COLLECTOR_VM.md, "Publish an index backfill"), only when asked for with a marker file.
# state/ is never published and survives the reset above. The marker goes away once the result has been pushed.
BACKFILL_REQUEST="$DATA_DIR/state/run-index-backfill"
BACKFILLED=""
if [ -f "$BACKFILL_REQUEST" ]; then
  if node "$ROOT/collector/backfill-indexes.ts" "$DATA_DIR"; then
    BACKFILLED=1
  else
    echo "index backfill failed (nothing replaced; tried again next run)"
  fi
fi
# Market indexes: an extra that must never stop the price collection.
node "$ROOT/collector/indexes.ts" "$DATA_DIR" || echo "indexes failed (prices still published)"
# Weekly recap (after the indexes, which it reads): an extra too.
node "$ROOT/collector/recaps.ts" "$DATA_DIR" || echo "recaps failed (prices still published)"

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
if [ -n "$BACKFILLED" ]; then rm -f "$BACKFILL_REQUEST"; fi

# Cloudflare R2 copy (what the app reads first, docs/R2_DATA.md): only when R2 is configured, and never a reason to
# fail the run (the GitHub copy above is published either way).
if [ -n "${R2_ACCOUNT_ID:-}" ] || grep -qs '^R2_ACCOUNT_ID=.' "$ROOT/.env"; then
  node --env-file-if-exists="$ROOT/.env" "$ROOT/collector/r2-publish.ts" "$DATA_DIR" || echo "R2 publish failed (GitHub copy published)"
fi

# Daily, weekly and monthly recaps on Discord: after the R2 publish (the recap pages read R2), start the "Post recap"
# workflow on GitHub for each new recap (collector/discord-recap.ts dispatch; the workflow renders and posts). Only
# when DISCORD_RECAP_DISPATCH=1; never a reason to fail the run.
if [ "${DISCORD_RECAP_DISPATCH:-}" = "1" ]; then
  node "$ROOT/collector/discord-recap.ts" dispatch "$DATA_DIR" || echo "Discord recap not sent to GitHub (retried next run)"
fi
