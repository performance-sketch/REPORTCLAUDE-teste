#!/usr/bin/env python3
"""
Fetch confirmed Rezdy bookings for May 26 – Jun 27 (2025 & 2026),
regenerate ORDERS in analise-rezdy-periodos.html and ORDERS_PERIODOS in index.html.

Env:  REZDY_API_KEY  (set as GitHub Actions secret)
Run:  python scripts/update_rezdy_data.py
"""
import os, re, sys, time, json as _json, requests
import log_seguro  # esconde tokens em tudo que é impresso (logs públicos)
log_seguro.ativar()
from datetime import date

API_KEY  = os.environ.get("REZDY_API_KEY", "")
BASE_URL = "https://api.rezdy.com/v1"
SCRIPT_DIR  = os.path.dirname(__file__)
HTML_FILE   = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "analise-rezdy-periodos.html"))
INDEX_FILE  = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "index.html"))
JSON_FILE   = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "data", "periodos.json"))

if not API_KEY:
    sys.exit("ERROR: REZDY_API_KEY environment variable is not set.")

# We need bookings created between 2025-05-26 and 2026-06-27.
# Rezdy returns bookings newest-first; we paginate until dateCreated < STOP_DATE.
STOP_DATE   = "2025-05-25"   # stop fetching when we reach orders older than this
PERIOD_2025 = ("2025-05-26", "2025-06-27")
_today      = date.today().isoformat()
PERIOD_2026 = ("2026-05-26", _today)


# ── CATEGORISATION ─────────────────────────────────────────────────────────────

def get_prod(name: str) -> str:
    n = (name or "").strip()
    if "GYG" in n:
        return "GYG"
    if n == "Doors off | 30min":
        return "30min"
    if n == "Doors off | 45min":
        return "45min"
    return "Other"

def get_src(raw_source: str, prod: str) -> str:
    """Map Rezdy API source (uppercase) to dashboard category."""
    if prod == "GYG":
        return "GYG"
    s = (raw_source or "").upper()
    if s == "ONLINE":
        return "Online"
    # INTERNAL, API, AGENT, NEGOTIATED_RATE, empty → Interno
    return "Interno"


# ── API FETCHING ────────────────────────────────────────────────────────────────

def fetch_all_bookings() -> list:
    """
    Paginate /v1/bookings (newest first) until we're past STOP_DATE.
    Returns raw booking dicts for the years we care about.
    """
    all_b, offset, limit = [], 0, 100
    print(f"Fetching bookings (stopping when dateCreated < {STOP_DATE})...")

    while True:
        for attempt in range(4):
            resp = requests.get(
                f"{BASE_URL}/bookings",
                params={"apiKey": API_KEY, "limit": limit, "offset": offset},
                timeout=30,
            )
            if resp.status_code == 406 and attempt < 3:
                wait = 15 * (attempt + 1)
                print(f"  rate limited at offset={offset}, waiting {wait}s...")
                time.sleep(wait)
                continue
            break
        if not resp.ok:
            print(f"  API error {resp.status_code}: {resp.text[:300]}")
            resp.raise_for_status()

        batch = resp.json().get("bookings", [])
        if not batch:
            break

        all_b.extend(batch)
        oldest = batch[-1].get("dateCreated", "")[:10]
        print(f"  offset={offset:4d}  got={len(batch):3d}  total={len(all_b):4d}  oldest={oldest}")

        if oldest < STOP_DATE or len(batch) < limit:
            break

        offset += limit
        time.sleep(0.8)   # stay well under 100 req/min rate limit

    return all_b


# ── PARSING ─────────────────────────────────────────────────────────────────────

def in_period(date_str: str, period: tuple) -> bool:
    return period[0] <= date_str <= period[1]

def parse_booking(b: dict) -> dict | None:
    """Convert one Rezdy API booking to our dashboard order format."""
    if (b.get("status") or "").upper() != "CONFIRMED":
        return None

    d = (b.get("dateCreated") or "")[:10]
    if not d:
        return None

    year = int(d[:4])
    if year not in (2025, 2026):
        return None

    period = PERIOD_2025 if year == 2025 else PERIOD_2026
    if not in_period(d, period):
        return None

    # Fulfillment date lives on the first line item, not at booking level
    items  = b.get("items") or []
    item0  = items[0] if items else {}
    df_raw = (item0.get("startTimeLocal") or item0.get("startTime") or "")
    df     = df_raw[:10] if df_raw else d   # fallback: booking date

    prod_name = item0.get("productName", "")
    prod      = get_prod(prod_name)
    src       = get_src(b.get("source", ""), prod)

    gross = float(b.get("totalAmount") or 0)
    paid  = float(b.get("totalPaid")   or 0)
    due   = float(b.get("totalDue")    or 0)

    # Free of charge = amount that was comped (paid=0, due=0, gross>0)
    free = round(max(0.0, gross - paid - due), 2)
    net  = round(gross - free, 2)
    gross = round(gross, 2)

    # PAX from first item (totalQuantity is the sum Rezdy already computes)
    pax = int(item0.get("totalQuantity") or 0)
    if pax == 0:
        pax = 1

    return {
        "y": year, "d": d, "df": df,
        "net": net, "free": free, "gross": gross,
        "pax": pax, "prod": prod, "src": src,
    }


# ── MAIN ─────────────────────────────────────────────────────────────────────────

def main():
    raw = fetch_all_bookings()
    print(f"\nTotal raw bookings fetched: {len(raw)}")

    orders = []
    for b in raw:
        o = parse_booking(b)
        if o:
            orders.append(o)

    if not orders and raw:
        print("\nDEBUG: no orders parsed — printing first raw booking fields:")
        first = raw[0]
        for k, v in first.items():
            if k != "items":
                print(f"  {k}: {v!r}")
        if first.get("items"):
            print(f"  items[0]: {first['items'][0]!r}")

    by_yr = {2025: sum(1 for o in orders if o["y"] == 2025),
             2026: sum(1 for o in orders if o["y"] == 2026)}
    print(f"Parsed confirmed orders → 2025: {by_yr[2025]}  2026: {by_yr[2026]}")

    # Sort: most recent year and date first
    orders.sort(key=lambda o: (o["y"], o["d"]), reverse=True)

    # Build JS array
    entries = [
        (f'{{"y":{o["y"]},"d":"{o["d"]}","df":"{o["df"]}",'
         f'"net":{o["net"]},"free":{o["free"]},"gross":{o["gross"]},'
         f'"pax":{o["pax"]},"prod":"{o["prod"]}","src":"{o["src"]}"}}')
        for o in orders
    ]
    today = date.today().strftime("%d/%m/%Y")

    # ── Patch analise-rezdy-periodos.html ──────────────────────────────────────
    js_arr = "var ORDERS = [" + ",".join(entries) + "];"
    with open(HTML_FILE, "r", encoding="utf-8") as f:
        html = f.read()
    start = html.index("var ORDERS = [")
    end   = html.index("];", start) + 2
    html  = html[:start] + js_arr + html[end:]
    html  = re.sub(r"\d{2}/\d{2}/\d{4} &middot; Vertical Rio",
                   f"{today} &middot; Vertical Rio", html)
    with open(HTML_FILE, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\nUpdated analise-rezdy-periodos.html  ({len(orders)} orders)")

    # ── Write data/periodos.json (fetched by index.html at runtime) ────────────
    os.makedirs(os.path.dirname(JSON_FILE), exist_ok=True)
    with open(JSON_FILE, "w", encoding="utf-8") as f:
        _json.dump(orders, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Updated data/periodos.json            ({len(orders)} orders)")

    # REZDY_DATA do index.html é gerado por gerar_dashboard.py (processar_rezdy),
    # que separa Confirmados / Abandonados (ABANDONED_CART) / On Hold / Cancelados / Outros
    # e usa a data em horário de Brasília. Sobrescrever aqui apagava on_hold/cancelled
    # e classificava cancelados como abandonados — por isso não mexemos mais no index.html.
    print(f"Footer: {today}")



if __name__ == "__main__":
    main()
