"""Чтение старых записей: имена колонок вместо русских подписей («Спальня: is_archived»).

Новые события пишутся с русскими названиями (`room_mutation_service._changed_fields_label`),
но уведомления и лента, созданные раньше, хранят сырые имена полей. Данные не мигрируем —
подменяем при чтении, только для известных имён полей комнаты.
"""
from __future__ import annotations

import re


def localize_field_names(text: str | None) -> str | None:
    if not text or "_" not in text and not any(k in text for k in ("name", "notes")):
        return text
    from app.services.room_mutation_service import _FIELD_LABELS_RU

    # «name»/«notes» слишком общие слова: подменяем только составные имена колонок.
    keys = [k for k in _FIELD_LABELS_RU if "_" in k]
    if not keys:
        return text
    pattern = re.compile(r"\b(" + "|".join(re.escape(k) for k in keys) + r")\b")
    return pattern.sub(lambda m: _FIELD_LABELS_RU[m.group(1)], text)


_LEGACY_BARE_CODES = {
    "customer": "Подписал: заказчик",
    "contractor": "Подписал: исполнитель",
    "low": "Серьёзность: низкая",
    "medium": "Серьёзность: средняя",
    "high": "Серьёзность: высокая",
    "critical": "Серьёзность: критичная",
}


def localize_bare_code(text: str | None) -> str | None:
    """Тело, состоящее из одного кода роли/серьёзности («contractor», «medium»), -> русская фраза."""
    if not text:
        return text
    return _LEGACY_BARE_CODES.get(text.strip(), text)


_LEGACY_DUE_DATE = re.compile(r"\bдо (\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.]+)?(?!\d)")


def localize_due_dates(text: str | None) -> str | None:
    """«… · до 2026-10-05» (старые сообщения-задачи) -> «… · до 05.10.2026»."""
    if not text or "до 20" not in text:
        return text
    return _LEGACY_DUE_DATE.sub(lambda m: f"до {m.group(3)}.{m.group(2)}.{m.group(1)}", text)
