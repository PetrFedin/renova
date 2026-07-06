"""Парсинг цен по URL (Petrovich/Leroy/OBI) с fallback."""
import re
import random

SHOPS = {"lemanapro": (400, 14000), "lemana": (400, 14000), "leroymerlin": (500, 12000), "leroy": (500, 12000), "petrovich": (800, 15000), "obi": (600, 10000)}
PRICE_RE = re.compile(r"(\d{1,3}(?:[\s\u00a0]?\d{3})*(?:[.,]\d{2})?)\s*(?:₽|руб|RUB)?", re.I)

async def fetch_price(url: str, current: float = 0) -> tuple[float, str, str]:
    u = url.lower()
    shop = "generic"
    for key in SHOPS:
        if key in u: shop = key; break
    try:
        import httpx
        async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "RenovaBot/1.0"})
            if r.status_code == 200:
                nums = []
                for m in PRICE_RE.finditer(r.text[:120000]):
                    raw = m.group(1).replace(" ", "").replace("\u00a0", "").replace(",", ".")
                    try:
                        v = float(raw)
                        if 10 < v < 500000: nums.append(v)
                    except ValueError:
                        pass
                if nums:
                    return round(sorted(nums)[0], 2), shop, "live"
    except Exception:
        pass
    lo, hi = SHOPS.get(shop, (500, 5000))
    base = current if current > 0 else lo + random.random() * (hi - lo)
    return round(base * (0.97 + random.random() * 0.06), 2), shop, "stub"
