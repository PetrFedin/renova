"""ЮKassa: создание платежа (stub без ключей → demo activate)."""
import uuid

_seen_keys: set[str] = set()
YOOKASSA_IPS = {"185.71.76.0/27", "185.71.77.0/27", "77.75.153.0/25", "77.75.156.11", "77.75.156.35", "2a02:5180::/32"}

import httpx
from app.core.config import settings

async def create_payment(amount: float, description: str, return_url: str, user_id: str | None = None, idempotence_key: str | None = None) -> dict:
    if not settings.yookassa_shop_id or not settings.yookassa_secret:
        return {"demo": True, "payment_id": str(uuid.uuid4()), "confirmation_url": return_url, "status": "pending"}
    auth = (settings.yookassa_shop_id, settings.yookassa_secret)
    payload = {
        "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
        "confirmation": {"type": "redirect", "return_url": return_url},
        "capture": True,
        "description": description,
    }
    if user_id:
        payload["metadata"] = {"user_id": user_id}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post("https://api.yookassa.ru/v3/payments", json=payload, auth=auth, headers={"Idempotence-Key": idempotence_key or str(uuid.uuid4())})
        r.raise_for_status()
        d = r.json()
        return {"demo": False, "payment_id": d["id"], "confirmation_url": d["confirmation"]["confirmation_url"], "status": d["status"]}


def check_webhook_ip(client_ip: str | None) -> bool:
    from app.core.config import settings
    if settings.environment != "production":
        return True
    if not client_ip:
        return False
    import ipaddress
    ip = ipaddress.ip_address(client_ip)
    for cidr in YOOKASSA_IPS:
        if "/" in cidr:
            if ip in ipaddress.ip_network(cidr, strict=False):
                return True
        elif client_ip == cidr:
            return True
    return False

def remember_webhook(event_id: str) -> bool:
    if event_id in _seen_keys:
        return False
    _seen_keys.add(event_id)
    return True
