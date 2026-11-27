# Collector on an Oracle VM

The price collector runs once an hour from a systemd timer on Guilded's **Guilded-DB** VM, an Oracle Always Free
micro: 1 GB of memory, 2 CPUs, 45 GB of disk, Ubuntu 24.04, private IP 10.0.0.145, reached through the bot server
168.138.70.194. Before this it ran on GitHub Actions as an hour-long, self-restarting job: a risk under GitHub's terms,
and GitHub skipped its schedules for hours on 19 November. GitHub Actions stays as a manual fallback.

Why this VM: on 23 November 2026 it had 566 MB of memory available and 42 GB of free disk. The bot VM had 292 MB
available and 84% of its disk used. The collector peaks around 400 MB while it rebuilds a house, so the install adds a
2 GB swap file, and the service gets its own memory limit and the lowest CPU and disk priority, so PostgreSQL is never
squeezed. A run takes about one minute.

| File | What |
| --- | --- |
| `deploy/collector/install.sh` | One-time setup, as root: swap file, git, Node 24 (checksum-verified), user `goblin`, `/opt/goblin-ledger/{app,data}`, the env file, systemd units. Safe to run again |
| `deploy/collector/run.sh` | One run: updates the collector code from `main`, then `collector/publish.sh` (collect, indexes, weekly recap, push the `data` branch) |
| `deploy/collector/goblin-collector.service` | The run, as user `goblin`, with the memory and priority limits |
| `deploy/collector/goblin-collector.timer` | :30 every hour (Blizzard refreshes around :25) and :45 as a retry; a stored snapshot is skipped |
| `/etc/goblin-ledger/collector.env` (server only) | `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `GITHUB_TOKEN`, and the four `R2_*` values once R2 is set up ([R2_DATA.md](R2_DATA.md)); mode 0640 root:goblin, never committed |

## Install (once, after this PR is merged)

Run everything from Git Bash on the owner's PC.

**1. Connect to the DB VM through the bot server.**

```bash
ssh -i ~/.ssh/guilded_oracle -o "ProxyCommand=ssh -i ~/.ssh/guilded_oracle -W %h:%p ubuntu@168.138.70.194" ubuntu@10.0.0.145
```

**2. Run the install script.**

```bash
curl -fsSL https://raw.githubusercontent.com/kevincaron28/Trading-Wow/main/deploy/collector/install.sh -o /tmp/goblin-install.sh
sudo bash /tmp/goblin-install.sh
```

It ends with `fill in /etc/goblin-ledger/collector.env`. Cloning the data branch takes a few minutes.

**3. Fill in the secrets.** Open the file with `sudo nano /etc/goblin-ledger/collector.env`, put the three values
after the `=` signs, then save (Ctrl+O, Enter, Ctrl+X).
- `BNET_CLIENT_ID` and `BNET_CLIENT_SECRET`: the "Goldline Forever" client at
  <https://develop.battle.net/access/clients>. GitHub never shows its saved secrets again, so take them from Battle.net.
- `GITHUB_TOKEN`: <https://github.com/settings/personal-access-tokens/new>, a fine-grained token with repository
  access *Only select repositories: Trading-Wow*, permission *Contents: Read and write*, and an expiry date (put the
  renewal in your calendar).

Never paste these values into a chat, an issue or a commit.

**4. First run by hand, then the timer.**

```bash
sudo systemctl start goblin-collector.service
sudo journalctl -u goblin-collector -n 40 --no-pager
```

The log should end with `published HH:MM UTC`. On the first run, "sold n/a" is normal: the sales estimate needs the
previous hour's snapshot from this VM. Then turn on the timer:

```bash
sudo systemctl enable --now goblin-collector.timer
systemctl list-timers goblin-collector.timer --no-pager
```

**5. Turn off the GitHub schedule.** Once one or two hourly runs have published, open GitHub > Trading-Wow >
Settings > Secrets and variables > Actions > **Variables** > New repository variable: name `COLLECTOR_ON_VM`, value
`true`. From then on:
- "Collect prices" runs only when started by hand (Actions > Collect prices > Run workflow).
- The watchdog starts nothing. It fails, and GitHub emails you, when prices are more than 2 hours old.

## Day to day

| Check | Command (on the VM) |
| --- | --- |
| Next and last run | `systemctl list-timers goblin-collector.timer --no-pager` |
| Last run's log | `sudo journalctl -u goblin-collector -n 60 --no-pager` |
| Failed runs today | `sudo journalctl -u goblin-collector --since today -p err --no-pager` |
| Memory | `free -m` |
| Prices age (from anywhere) | `curl -s https://raw.githubusercontent.com/kevincaron28/Trading-Wow/data/meta.json \| head -c 80` |

The collector code updates itself: each run uses the latest `main`. Re-run step 2 only when
`deploy/collector/*.service`, `*.timer` or `install.sh` change.

## Publish an index backfill

The index series rebuilt with method 4 ([INDEXES.md](INDEXES.md)) is published only when asked for: merging the code
publishes nothing. **Run it before 2 December 2026, 02:00 UTC** (21:00 Eastern on 1 December): after that the 14 days of
hourly prices no longer reach our first day, and the script refuses.

On the server, ask for it once:

```bash
sudo -u goblin touch /opt/goblin-ledger/data/state/run-index-backfill
```

The next hourly run (about :30) rebuilds every index, copies the old files to `index/legacy/`, publishes both to the
data branch and R2, and removes the marker. From then on the hourly runs stay on method 4. Check it:

```bash
journalctl -u goblin-collector --since "1 hour ago" | grep -E "index|published|r2"
```

Expected: `wrote 13 files to .../index; 13 old files kept in index/legacy/`, then `index 113: ... method 4`.

- **Undo:** stop the timer, copy `index/legacy/*.json` over `index/` in the data checkout, commit, push the `data`
  branch and run `collector/r2-publish.ts`; then start the timer. The next run continues method 3 from those files.
- **Recaps already written** (`recap/<house>/`) keep the index values of the day they were made: `recaps.ts` writes only
  missing periods. Later recaps and the weekly summary read the new series.
- **Preview without publishing** (any machine with a copy of the `data` branch):
  `node collector/backfill-indexes.ts <data> --out <preview folder>`.
- If the VM is down and GitHub Actions is collecting, the marker cannot be placed there: run the backfill on the VM once
  it is back, or ask for a manual run.

## Discord recaps

The daily, weekly and monthly recaps are posted to one Discord channel as **Goblin Ledger** (name, icon and footer;
nothing else is named):
- the daily recap every day at about 13:30 UTC (8:30 in Québec in winter, 9:30 in summer);
- the weekly recap on Mondays;
- the monthly recap on the 1st.

**How it runs.** After the hourly run that first covers 13:00 UTC has published the new recap to R2, the VM starts
GitHub's **Post recap** workflow (`.github/workflows/recap-post.yml`) with a `repository_dispatch` event
(`collector/discord-recap.ts dispatch`). It is an event, not a schedule: GitHub skipped scheduled runs for hours on 19
November. The workflow then:
1. builds the app and opens the recap pages (`recap.html`, `src/recap/`) in headless Chromium (Playwright,
   `scripts/render-recap.mjs`): four 1200 px images drawn with the app's own styles, chart and rows;
2. writes the summary (below) and posts the message with the images (`collector/discord-recap.ts post`).

The VM draws nothing and holds no Discord or AI secret; it only needs its `GITHUB_TOKEN` (Contents: read and write)
to start the workflow.

**The post** (samples in `docs/recap-pages/`):
- A short embed: the title (kind, date, house), a 2 to 3 sentence summary, four numbers (Ledger 100, the biggest
  sector move, raid consumables sold a day, gold traded a day) and two links: the app ("📱 Tester Goblin Ledger
  (Android)" during the closed test, "📱 Goblin Ledger sur Google Play" once public) and "🌐 Ouvrir le marché".
- Four images, shown as one gallery: 1. the market (Ledger 100 chart, sector tiles, most traded), 2. top movers and
  new highs and lows, 3. raid consumables, 4. flips and crafts.
- Labels in French (or English), item names always in English, as players search the auction house.
- Movers and records only list real markets: items selling 10+ a day, 500+ gold traded a day, priced 1 gold or more
  (`MOVER_RULES` in `collector/weekly.ts`).

Each recap is sent once: the VM keeps what it sent in `state/discord-posted.json`. A recap more than 12 hours old is
never sent (24 hours for weekly, 48 for monthly), so the channel gets no burst after an outage. If the workflow fails,
run it again by hand (below) with "Dry run" unticked.

**Settings.**

| Where | Name | What |
| --- | --- | --- |
| GitHub secret | `DISCORD_RECAP_WEBHOOK` | The channel's webhook URL |
| GitHub secret | `RECAP_AI_API_KEY` | Optional: the summary model's key (below) |
| GitHub variable | `RECAP_AI_BASE_URL`, `RECAP_AI_MODEL` | Optional: the summary model (below) |
| GitHub variable | `GOBLIN_APP_URL` | The app link. Unset: the closed test's opt-in page, `https://play.google.com/apps/testing/top.kcaron.goldline`. Set it to the kcaron.top tester page once it exists, and to `https://play.google.com/store/apps/details?id=top.kcaron.goldline` when the app is public (the label follows) |
| GitHub variable | `GOBLIN_WEB_URL` | The web app's address. Unset: no market link and item names in plain text. Set: item names link to `<address>?house=113&item=<id>`, the market to `?house=113&tab=overview` |
| GitHub variable | `DISCORD_RECAP_LANG` | Optional: `fr` (default) or `en` |
| VM, `collector.env` | `DISCORD_RECAP_DISPATCH=1` | Start the workflow after each run. Unset: nothing is posted |
| VM, `collector.env` | `DISCORD_RECAP_HOUSES` | Optional: houses to post, comma separated (default `113`, PvP Horde; IDs in `src/app/store.ts`, `REALM_GROUPS`) |
| VM, `collector.env` | `RECAP_DISPATCH_TOKEN` | Optional: a token for the dispatch, if `GITHUB_TOKEN` should not do it (fine-grained, Trading-Wow, Contents: read and write) |

GitHub secrets and variables: Trading-Wow > Settings > Secrets and variables > Actions.

**Owner's steps (once):**
1. Webhook: in the Québec Gold Discord server, gold-making recap channel > **Edit Channel** > **Integrations** >
   **Webhooks** > **New Webhook**, named `Goblin Ledger`. **Copy Webhook URL** and save it as the GitHub secret
   `DISCORD_RECAP_WEBHOOK`. The webhook already made for the VM can be reused: save the same URL.
2. Optional: the AI summary secret and variables (below).
3. Dry run: Actions > **Post recap** > **Run workflow**, key = the latest daily recap's date (in
   `https://data.kcaron.top/recap/113/list.json`), "Dry run" ticked. Open the run's artifact: the four images, the
   message (`*-message.json`) and the summary (`*-summary.json`, with `source`: `ai`, `ai-retry` or `template`).
4. On the VM, add `DISCORD_RECAP_DISPATCH=1` to `/etc/goblin-ledger/collector.env` (`sudo nano`), and remove the
   old `DISCORD_RECAP_WEBHOOK` and `RECAP_AI_*` lines: the VM no longer uses them. No restart: the next run reads it.
5. The next day after 13:30 UTC, check the channel, the run under Actions > Post recap, and the VM log:
   `sudo journalctl -u goblin-collector --since today --no-pager | grep discord` (`workflow started for ...`).

The webhook URL is a secret: anyone who has it can post in the channel. If it leaks, delete the webhook in Discord
and make a new one. It is never printed. To stop the posts, remove `DISCORD_RECAP_DISPATCH` on the VM, or delete the
webhook.

To preview on a PC: `npm run build`, then `node scripts/render-recap.mjs --key <date>` (images in `recap-images/`),
then `node collector/discord-recap.ts post <dataDir> --house 113 --kind daily --key <date> --images recap-images
--dry-run` with the recap's files downloaded into `<dataDir>` (as the workflow does).

## Recap summaries (AI)

Each recap posted to Discord opens with a 2 to 3 sentence market-close summary. The code is in
`collector/recap-ai.ts`; it runs in the Post recap workflow.

- **Without settings** (the default), the summary is the template one: the first three of the app's recap notes.
- **With an AI model**, the model sees only the recap's facts (as JSON) and the reviewed notes in
  `docs/WOW_FOREVER_CONTEXT.md`. It runs at temperature 0.2 and is told to use nothing else, and to keep item names
  in English.
- **Accuracy guard.** Before anything is posted, the code checks the text:
  - every amount of gold, percentage and number must be in the data;
  - a percentage next to an item or index must be that one's own figure;
  - "rose" and "fell" must match the sign of the move;
  - every item named must be one the recap lists;
  - the text must be 2 to 4 sentences, with no links or markup.

  A text that fails is asked for once more. If that also fails, or if the model is down, slow (30 s timeout) or out
  of quota, the template summary is posted instead. An unchecked text is never posted. Item names the recap lists are
  linked to the web app afterwards (when `GOBLIN_WEB_URL` is set).
- **The log** says which path was used: `summary from ai`, `ai-retry` or `template`, with the reasons.
- **Free tier.** Each recap makes one request, two at most when the guard rejects the first text. A 429 or 5xx is
  retried once after a pause. Posting one house uses about 1 to 3 requests a day, which fits the free tier of
  Google's Gemini API.

Settings (GitHub, all three or none): the secret `RECAP_AI_API_KEY` (the Google AI Studio key) and the variables
`RECAP_AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai` and `RECAP_AI_MODEL=gemini-flash-latest`.

`gemini-flash-latest` is Google's alias for its newest Flash model. To pin a model, put its ID instead: the free
models are listed in Google AI Studio under the key's project, under Rate limits. When the model ID is wrong, the log
shows `model answered HTTP 404` and the template is posted.

Keep `docs/WOW_FOREVER_CONTEXT.md` current: it says when the facts were last checked and how to update them. The
model may only use what it lists.

## Troubleshooting

- **No Discord recap:** on the VM, `sudo journalctl -u goblin-collector --since today --no-pager | grep -E 'recaps|discord'` (`workflow started for ...`, or why not: `HTTP 401/403/404` from GitHub means the token cannot start workflows). Then GitHub > Actions > Post recap: `Discord answered HTTP 401` or `404` means the webhook was deleted (make a new one, Discord recaps, step 1). Run it again by hand to post.
- **Prices are old (watchdog email):** read the log (table above).
  - `HTTP 401` from Battle.net: the client secret changed; update `collector.env`.
  - `Authentication failed` on push: the GitHub token expired; make a new one (step 3).
  - Killed by the memory limit, or the VM is down: start a run by hand on GitHub (Actions > Collect prices > Run
    workflow) while you fix it.
- **Stop collecting on the VM:** `sudo systemctl disable --now goblin-collector.timer`. Then delete the
  `COLLECTOR_ON_VM` variable on GitHub to give the schedule back to GitHub Actions.
- **Remove everything:** stop the timer as above, then
  `sudo rm /etc/systemd/system/goblin-collector.* && sudo systemctl daemon-reload && sudo rm -rf /opt/goblin-ledger /etc/goblin-ledger`.
  The swap file can stay.
