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
| `/etc/goblin-ledger/collector.env` (server only) | `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `GITHUB_TOKEN`; mode 0640 root:goblin, never committed |

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

## Troubleshooting

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
