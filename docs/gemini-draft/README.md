# WoW: Forever — Horde PvP Auction House TradingView Terminal

Pre-configured Docker Compose repository that automatically initializes PostgreSQL, applies the schema and crafting margin views (`v_latest_market_prices` and `v_live_crafting_margins`), pre-seeds 72 hours of US PvP Horde candlestick data, runs the Battle.net `dynamic-forever-us` poller, and serves the mobile TradingView PWA on port `8000`.

## Quick Start (Windows PowerShell)
```powershell
.\start-and-push.ps1
```
Or with Docker Compose directly:
```bash
docker compose up -d --build
```
Then open `http://localhost:8000` (or `http://<your-pc-ip>:8000` on your phone).
