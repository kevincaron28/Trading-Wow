#!/usr/bin/env bash
# Publish the AHledger series (ext/ahledger), the merged early history (early/), the indexes and the coverage report
# onto the data branch without undoing the collector: start from the newest data, change only those folders, push
# with a lease, retry up to 5 times if the collector pushed in between.
#   collector/publish-ahledger.sh <data-branch checkout> <ahledger state dir>
set -euo pipefail
DATA_DIR="${1:?usage: publish-ahledger.sh <data dir> <state dir>}"
STATE_DIR="$(cd "${2:?usage: publish-ahledger.sh <data dir> <state dir>}" && pwd)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DATA_DIR"
for attempt in 1 2 3 4 5; do
  git fetch -q origin data
  git reset -q --hard FETCH_HEAD
  base=$(git rev-parse HEAD)
  node "$ROOT/collector/backfill-ahledger.ts" write "$STATE_DIR" .
  node "$ROOT/collector/merge-history.ts" .
  node "$ROOT/collector/indexes.ts" . || echo "indexes failed (history still published)"
  node "$ROOT/collector/coverage.ts" . > /dev/null || true
  git add -A ext early index audit
  if git diff --cached --quiet; then echo "nothing new to publish"; exit 0; fi
  git commit -q --amend -m "$(git log -1 --format=%s | sed 's/ + .*//') + early history"
  if git push -q --force-with-lease=data:"$base" origin HEAD:data; then
    echo "published ext/ahledger + early/ at $(date -u +%H:%M) UTC (attempt $attempt)"
    exit 0
  fi
  echo "the data branch moved (collector run?); retrying in 30 s"
  sleep 30
done
echo "could not publish after 5 attempts" >&2
exit 1
