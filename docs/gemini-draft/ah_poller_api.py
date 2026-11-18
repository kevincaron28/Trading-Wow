import os
import time
import threading
from datetime import datetime, timezone
from collections import defaultdict
import requests
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

BNET_CLIENT_ID = os.getenv("BNET_CLIENT_ID", "YOUR_BNET_CLIENT_ID")
BNET_CLIENT_SECRET = os.getenv("BNET_CLIENT_SECRET", "YOUR_BNET_CLIENT_SECRET")
DB_DSN = os.getenv("DB_DSN", "dbname=wow_ah user=postgres password=postgres host=localhost port=5432")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")

RULESET_ID = int(os.getenv("WOW_RULESET_ID", "1"))
HORDE_HOUSE_ID = int(os.getenv("WOW_HOUSE_ID", "113"))
NAMESPACE = "dynamic-forever-us"

app = FastAPI(title="WoW Forever AH TradingView API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

last_modified_cache = {"auctions": None, "commodities": None}

def get_db_conn():
    return psycopg2.connect(DB_DSN)

def format_gsc(copper: int) -> str:
    val = abs(int(copper))
    g = val // 10000
    s = (val % 10000) // 100
    c = val % 100
    parts = []
    if g > 0:
        parts.append(f"{g}g")
    if s > 0 or g > 0:
        parts.append(f"{s}s")
    parts.append(f"{c}c")
    return ("-" if copper < 0 else "") + " ".join(parts)

def get_bnet_token() -> str:
    resp = requests.post(
        "https://oauth.battle.net/token",
        auth=(BNET_CLIENT_ID, BNET_CLIENT_SECRET),
        data={"grant_type": "client_credentials"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]

def compute_trimmed_ohlcv(listings: list[tuple[int, int]], prev_close: int | None):
    listings.sort(key=lambda x: x[0])
    low_copper = listings[0][0]
    total_vol = sum(qty for _, qty in listings)
    auction_count = len(listings)

    target_close_vol = max(1, int(total_vol * 0.20))
    accum_vol = 0
    accum_cost = 0
    for price, qty in listings:
        take = min(qty, target_close_vol - accum_vol)
        accum_cost += take * price
        accum_vol += take
        if accum_vol >= target_close_vol:
            break
    close_copper = int(accum_cost / accum_vol)

    target_high_vol = max(1, int(total_vol * 0.50))
    running_vol = 0
    high_copper = close_copper
    for price, qty in listings:
        running_vol += qty
        if running_vol >= target_high_vol:
            high_copper = max(close_copper, price)
            break

    open_copper = prev_close if prev_close is not None else close_copper
    return open_copper, high_copper, low_copper, close_copper, total_vol, auction_count

def send_discord_snipe_alerts(conn):
    if not DISCORD_WEBHOOK_URL:
        return
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT name, min_buyout_copper, sma_7d_copper, snipe_discount_pct, volume_listed
            FROM v_latest_market_prices
            WHERE is_vendor_item = FALSE AND snipe_discount_pct <= -30.0
            ORDER BY snipe_discount_pct ASC
            LIMIT 5
        """)
        snipes = cur.fetchall()
    if not snipes:
        return
    lines = [
        f"• **{row['name']}**: Min Buyout `{format_gsc(row['min_buyout_copper'])}` "
        f"({row['snipe_discount_pct']}% vs 7D SMA `{format_gsc(row['sma_7d_copper'])}`) — Vol: {row['volume_listed']}"
        for row in snipes
    ]
    payload = {
        "username": "WoW Forever AH Sniper",
        "content": "🚨 **Horde PvP AH Snipe Alert (>30% Below 7D SMA)**\n" + "\n".join(lines),
    }
    try:
        requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
    except Exception as exc:
        print(f"[Discord Webhook Error] {exc}")

def poll_blizzard_ah():
    if BNET_CLIENT_ID == "YOUR_BNET_CLIENT_ID" or not BNET_CLIENT_ID:
        print("[Poller] Running on pre-seeded Horde PvP database candles (set BNET_CLIENT_ID in .env for live polling).")
        return

    token = get_bnet_token()
    base_url = f"https://us.api.blizzard.com/data/wow/ruleset/{RULESET_ID}/auctions/{HORDE_HOUSE_ID}"
    endpoints = {
        "auctions": f"{base_url}?namespace={NAMESPACE}",
        "commodities": f"{base_url}/commodities?namespace={NAMESPACE}",
    }

    item_listings: dict[int, list[tuple[int, int]]] = defaultdict(list)
    updated_any = False

    for key, url in endpoints.items():
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept-Encoding": "gzip",
        }
        if last_modified_cache[key]:
            headers["If-Modified-Since"] = last_modified_cache[key]

        resp = requests.get(url, headers=headers, timeout=30)
        if resp.status_code == 304:
            continue
        if resp.status_code == 200:
            updated_any = True
            last_modified_cache[key] = resp.headers.get("Last-Modified")
            payload = resp.json()
            for row in payload.get("auctions", []):
                item_id = row["item"]["id"]
                qty = row.get("quantity", 1)
                unit_price = row.get("unit_price") or (row.get("buyout", 0) // max(1, qty))
                if unit_price > 0:
                    item_listings[item_id].append((unit_price, qty))

    if not updated_any or not item_listings:
        return

    bucket_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT item_id FROM items")
            known_ids = {r[0] for r in cur.fetchall()}
            missing_items = [(iid, f"Item #{iid}", "Auto-Discovered") for iid in item_listings if iid not in known_ids]
            if missing_items:
                execute_values(
                    cur,
                    "INSERT INTO items (item_id, name, category) VALUES %s ON CONFLICT DO NOTHING",
                    missing_items,
                )

            cur.execute("SELECT item_id, market_value_copper FROM v_latest_market_prices")
            prev_closes = {r[0]: r[1] for r in cur.fetchall()}

            candle_rows = []
            for item_id, listings in item_listings.items():
                o, h, l, c, vol, cnt = compute_trimmed_ohlcv(listings, prev_closes.get(item_id))
                candle_rows.append((item_id, bucket_time, o, h, l, c, vol, cnt))

            execute_values(
                cur,
                """
                INSERT INTO ah_candles_hourly
                    (item_id, bucket_time, open_copper, high_copper, low_copper, close_copper, volume_listed, auction_count)
                VALUES %s
                ON CONFLICT (item_id, bucket_time) DO UPDATE SET
                    high_copper = EXCLUDED.high_copper,
                    low_copper = EXCLUDED.low_copper,
                    close_copper = EXCLUDED.close_copper,
                    volume_listed = EXCLUDED.volume_listed,
                    auction_count = EXCLUDED.auction_count
                """,
                candle_rows,
            )
        conn.commit()
        send_discord_snipe_alerts(conn)
        print(f"[Poller] Stored {len(candle_rows)} hourly candles at {bucket_time.isoformat()}")
    finally:
        conn.close()

def background_worker():
    time.sleep(3)
    while True:
        try:
            poll_blizzard_ah()
        except Exception as exc:
            print(f"[Poller Error] {exc}")
        time.sleep(900)

@app.on_event("startup")
def start_poller():
    t = threading.Thread(target=background_worker, daemon=True)
    t.start()

@app.get("/")
def serve_pwa():
    return FileResponse("index.html")

@app.get("/manifest.json")
def serve_manifest():
    return FileResponse("manifest.json")

@app.get("/api/watchlist")
def get_watchlist():
    with get_db_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT item_id, name, category, min_buyout_copper, market_value_copper,
                   sma_7d_copper, volume_listed, snipe_discount_pct
            FROM v_latest_market_prices
            WHERE is_vendor_item = FALSE AND market_value_copper > 0
            ORDER BY snipe_discount_pct ASC
            LIMIT 50
        """)
        return cur.fetchall()

@app.get("/api/candles/{item_id}")
def get_candles(item_id: int):
    with get_db_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT EXTRACT(EPOCH FROM bucket_time)::BIGINT AS time,
                   open_copper AS open,
                   high_copper AS high,
                   low_copper AS low,
                   close_copper AS close,
                   volume_listed AS volume
            FROM ah_candles_hourly
            WHERE item_id = %s
            ORDER BY bucket_time ASC
            LIMIT 336
        """, (item_id,))
        return cur.fetchall()

@app.get("/api/margins")
def get_margins():
    with get_db_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM v_live_crafting_margins")
        return cur.fetchall()
