"""Статус внешних интеграций для оператора (только админ, без секретов)."""
from fastapi import APIRouter, Depends

from app.api.admin_access import require_admin_user
from app.models.entities import User
from app.services.integrations.registry import status_report

router = APIRouter(prefix="/integrations", tags=["admin"])


@router.get("/status")
async def integrations_status(user: User = Depends(require_admin_user)) -> dict:
    """Конфигурационный статус интеграций: configured / stub / partial, missing_keys, last_check.

    Живых обращений к провайдерам нет (``live_verified`` всегда false); значения секретов
    не возвращаются — только имена env-ключей.
    """
    return status_report()
