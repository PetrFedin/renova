"""L1: Проверка статуса самозанятого через публичный API ФНС."""
from datetime import date
import httpx
from app.core.config import settings


class FnsNpdError(Exception):
    pass


async def check_taxpayer_npd_status(inn: str, on_date: date | None = None) -> dict:
    """
    Проверяет, является ли ИНН плательщиком НПД на указанную дату.
    Документация: npd.nalog.ru/api_statusnpd_nalog_ru.pdf
    """
    request_date = (on_date or date.today()).isoformat()
    payload = {"inn": inn.strip(), "requestDate": request_date}

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(settings.fns_npd_status_url, json=payload)

    if response.status_code == 422:
        raise FnsNpdError("Указан некорректный ИНН")
    if response.status_code >= 500:
        raise FnsNpdError("Сервис ФНС временно недоступен")

    data = response.json()
    return {
        "inn": inn,
        "request_date": request_date,
        "is_npd": bool(data.get("status")),
        "message": data.get("message", ""),
    }
