"""Русские подписи для кодов, которые раньше попадали в тексты уведомлений как есть."""
from __future__ import annotations

SIGNER_RU = {"customer": "заказчик", "contractor": "исполнитель"}
SEVERITY_RU = {"low": "низкая", "medium": "средняя", "high": "высокая", "critical": "критичная"}


def signed_by_text(role: object) -> str:
    code = getattr(role, "value", role)
    return f"Подписал: {SIGNER_RU.get(str(code), 'участник')}"


def severity_text(severity: str | None) -> str:
    return f"Серьёзность: {SEVERITY_RU.get(severity or '', severity or 'не указана')}"
