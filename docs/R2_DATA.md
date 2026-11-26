# Price data on Cloudflare R2

The app and website read the price files from **Cloudflare R2** at `https://data.kcaron.top/`. The `data` branch on
GitHub (`raw.githubusercontent.com`) stays the fallback and a full copy until R2 is confirmed. GitHub's terms say
repositories are not meant to be a high-bandwidth CDN, and that branch held 583 MB in 15,281 files.

## What is on R2

`collector/r2-publish.ts` runs after each collection (from `collector/publish.sh`, when R2 is configured). It uploads
only changed files, gzipped (`Content-Encoding: gzip`), with `Cache-Control`.

| Path | Content | Cache |
| --- | --- | --- |
| `meta.json`, `items.json`, `latest/`, `index/`, `weekly/`, `recap/` | As on the data branch (docs/DATA.md). `meta.json` is uploaded last | 5 min |
| `h64/{house}/{itemId % 64}.json` | Item histories: the four `h2/` files `s`, `s+64`, `s+128`, `s+192` merged into one. That's 768 files instead of 3,072, all rewritten hourly | 5 min |
| `early/` | Daily prices before our own collection | 1 day |
| `early-h/` | Hourly prices before our own collection, **compacted**: hours older than 30 days are dropped, and their days stay in `early/` | 1 day |

Not on R2: `history/` (the old duplicate of `h2/`), the raw sources (`tsm/`, `ext/`, `seed/`, `audit/`) and `state/`.

Measured on 23 November 2026: **5,927 files, 67.6 MB gzipped**, against 583 MB in 15,281 files on GitHub. A full upload
takes about a minute and the uploader peaks at about 160 MB of memory.

Compaction:
- Our own hourly prices are already kept 14 days, then only the daily candle (`collector/store.ts`).
- `early-h/` is the only older hourly data. After 30 days only its daily values remain, so the 1H/4H charts show those
  days as the faded estimated line.

**Free tier.** R2 gives 10 GB of storage, 1 million writes and 10 million reads a month, with no egress fees. The upload
writes about 800 objects an hour: 768 history files plus about 40 small ones. That's about 590,000 a month. Reads go
through Cloudflare's cache on the custom domain, so cached hits are not R2 reads.

**How the app chooses** (`src/data/live.ts`):
- It reads R2's `meta.json` once per refresh, and uses R2 while those prices are at most 3 hours old. Otherwise it uses
  GitHub, so a stalled R2 copy never hides newer prices.
- A file that fails on R2 is fetched from GitHub.
- The background alert runner (`public/runners/alerts.js`) does the same for `latest/`.

## Set up (once), in the Cloudflare dashboard

1. **R2 > Create bucket:** name `goblin-ledger-data`, location Automatic.
2. **Bucket > Settings > Custom Domains > Connect domain:** `data.kcaron.top`. The `kcaron.top` zone is on this
   Cloudflare account. Leave the r2.dev public URL off: it is rate-limited and not for production.
3. **Bucket > Settings > CORS policy > Add:**
   ```json
   [{ "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400 }]
   ```
4. **kcaron.top > Caching > Cache Rules > Create rule:**
   - Name: "Goblin Ledger data".
   - When: *Hostname equals `data.kcaron.top`*.
   - Then: *Eligible for cache*, Edge TTL *Use cache-control header if present*, Browser TTL *Respect origin*.
   - Cloudflare does not cache `.json` without this rule.
5. **R2 > Manage API tokens > Create API token:**
   - Permission *Object Read & Write*, applied to the `goblin-ledger-data` bucket only.
   - Copy the *Access Key ID* and *Secret Access Key*; they are shown once.
   - Note the account ID from the S3 endpoint `https://<account id>.r2.cloudflarestorage.com`.
6. **On the collector VM** (connect as in docs/COLLECTOR_VM.md, step 1), add the four values to the env file with
   `sudo nano /etc/goblin-ledger/collector.env`:
   ```
   R2_ACCOUNT_ID=
   R2_ACCESS_KEY_ID=
   R2_SECRET_ACCESS_KEY=
   R2_BUCKET=goblin-ledger-data
   ```

## Migration (run once)

On the collector VM, as the collector's user, with its settings. No secrets are typed or shown:

```bash
sudo systemd-run --uid=goblin --gid=goblin --wait --pipe --collect \
  -p EnvironmentFile=/etc/goblin-ledger/collector.env -p WorkingDirectory=/opt/goblin-ledger -p MemoryMax=650M -p Nice=15 \
  /opt/node/bin/node /opt/goblin-ledger/app/collector/r2-publish.ts /opt/goblin-ledger/data --full
```

It ends with `r2: 5927 files, 5927 uploaded (... KB gzip)`. From then on, each hourly run uploads only what changed
(about 800 files). Check from any PC:

```bash
curl -sI https://data.kcaron.top/meta.json | grep -iE "^(HTTP|content-encoding|cache-control|cf-cache-status)"
curl -s --compressed https://data.kcaron.top/meta.json | head -c 120; echo
curl -sI -H "Origin: https://localhost" https://data.kcaron.top/latest/113.json | grep -i access-control-allow-origin
```

Expected:
- `HTTP/2 200`, `content-encoding: gzip`, `cache-control: public, max-age=300`, then `cf-cache-status: HIT` on a
  second request.
- A JSON `updated` time from the last hour.
- `access-control-allow-origin: *`.

Without the VM, the same migration works from a PC with the four `R2_*` values in the repo's gitignored `.env`:
`node --env-file=.env collector/r2-publish.ts ../wow-trading-data --full`. Use `--dry-run` to list what would be
uploaded without sending anything.

## Once R2 is confirmed (later)

After a week with R2 serving, with the app showing prices and `cf-cache-status: HIT`:
- remove the GitHub fallback in `src/data/live.ts` and `public/runners/alerts.js`;
- stop writing the old `history/` layout;
- push the `data` branch less often, or not at all.

Each of these is a small follow-up change.

## Troubleshooting

- **`r2: N file(s) failed`** in the collector log: they are sent again next run. `meta.json` waits until everything
  behind it is in place.
- **`HTTP 403`:** the API token was revoked or does not cover the bucket. Make a new one (step 5).
- **The app still reads GitHub:** check that `meta.json` on R2 is less than 3 hours old (`curl` above). The app
  decides again on every pull-to-refresh.
- **Turn R2 off:** remove the four `R2_*` lines from the env file. The app falls back to GitHub by itself within
  3 hours, as R2's `meta.json` gets old.
