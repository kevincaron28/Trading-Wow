#!/usr/bin/env bash
# Publish the ahprice.com series (ext/ahprice) and the coverage report onto the data branch without undoing anyone:
# start from the newest published data, change only ext/ and audit/, and push with a lease. If the hourly collector
# pushed in between, the lease fails and we start again from its commit (up to 5 tries).
#   collector/publish-ext.sh <data-branch checkout> <backfill state dir>
set -euo pipefail
DATA_DIR="${1:?usage: publish-ext.sh <data dir> <state dir>}"
STATE_DIR="$(cd "${2:?usage: publish-ext.sh <data dir> <state dir>}" && pwd)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DATA_DIR"
for attempt in 1 2 3 4 5; do
  git fetch -q origin data
  git reset -q --hard FETCH_HEAD
  base=$(git rev-parse HEAD)
  node "$ROOT/collector/backfill-ahprice.ts" write "$STATE_DIR" .
  node "$ROOT/collector/merge-history.ts" .
  node "$ROOT/collector/indexes.ts" . || echo "indexes failed (history still published)"
  node "$ROOT/collector/coverage.ts" . > /dev/null
  git add -A ext early index audit
  if git diff --cached --quiet; then echo "nothing new to publish"; exit 0; fi
  git commit -q --amend -m "$(git log -1 --format=%s | sed 's/ + ahprice.com.*//') + ahprice.com history"
  if git push -q --force-with-lease=data:"$base" origin HEAD:data; then
    echo "published ext/ahprice at $(date -u +%H:%M) UTC (attempt $attempt)"
    exit 0
  fi
  echo "the data branch moved (collector run?); retrying in 30 s"
  sleep 30
done
echo "could not publish after 5 attempts" >&2
exit 1
