"""Ошибки API в одной форме: код для клиента, текст для человека.

Большая часть маршрутов уже отдаёт ``detail={"code": ..., "message": ...}``.
Но 61 место поднимало ``HTTPException(404)`` без тела — FastAPI подставляет
туда ``{"detail": "Not Found"}``, и пользователь видит английскую строку,
которую приложению нечем заменить: кода в ответе нет.
"""
from fastapi import HTTPException

# Именительный падеж нужен только для сообщения «… не найден(а/о)»,
# поэтому храним сразу готовую фразу вместе с родом.
_NOT_FOUND: dict[str, str] = {
    "project": "Объект не найден",
    "stage": "Этап не найден",
    "room": "Комната не найдена",
    "issue": "Замечание не найдено",
    "expense": "Расход не найден",
    "receipt": "Чек не найден",
    "payment": "Счёт не найден",
    "purchase": "Закупка не найдена",
    "selection": "Позиция подбора не найдена",
    "change_order": "Доп. работы не найдены",
    "work_order": "Наряд не найден",
    "floor_plan": "План не найден",
    "floor_plan_pin": "Метка на плане не найдена",
    "furniture": "Объект на плане не найден",
    "scratchpad_line": "Строка черновика не найдена",
    "notification": "Уведомление не найдено",
    "chat_message": "Сообщение не найдено",
    "article": "Статья не найдена",
    "design_package": "Версия дизайн-пакета не найдена",
    "media": "Файл не найден",
    "report": "Отчёт пока не сформирован",
    "user": "Пользователь не найден",
}

_FORBIDDEN: dict[str, str] = {
    "customer_only": "Действие доступно только заказчику",
    "contractor_only": "Действие доступно только исполнителю",
    "owner_only": "Действие доступно только владельцу объекта",
}


def not_found(entity: str) -> HTTPException:
    """404 с кодом ``<entity>_not_found`` и русским текстом."""
    message = _NOT_FOUND.get(entity)
    if message is None:
        raise KeyError(f"unknown not_found entity: {entity}")
    return HTTPException(404, detail={"code": f"{entity}_not_found", "message": message})


def forbidden(reason: str) -> HTTPException:
    """403 с кодом причины и русским текстом."""
    message = _FORBIDDEN.get(reason)
    if message is None:
        raise KeyError(f"unknown forbidden reason: {reason}")
    return HTTPException(403, detail={"code": reason, "message": message})
