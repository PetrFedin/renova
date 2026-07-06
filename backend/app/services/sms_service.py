import httpx
from app.core.config import settings

async def send_sms(phone: str, text: str) -> dict:
    if not getattr(settings, "twilio_sid", None) or not getattr(settings, "twilio_token", None):
        return {"ok": True, "demo": True, "message": f"SMS stub → {phone}: {text[:80]}"}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_sid}/Messages.json",
            auth=(settings.twilio_sid, settings.twilio_token),
            data={"To": phone, "From": settings.twilio_from, "Body": text},
        )
        return {"ok": r.status_code < 300, "sid": r.json().get("sid") if r.status_code < 300 else None}
