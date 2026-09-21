"""Напоминание о сроке доработки приходит один раз, а не на каждый заход.

Найдено обходом прав: сводка мутирующих маршрутов от имени гостя read-only
дала ровно один ответ `200` — `POST /projects/{id}/rework-sla/check`.

Ручка называется «check», но рассылает уведомления исполнителю, а права
просила на чтение (`write=False`). Значит дёрнуть её мог любой, кому виден
объект, сколько угодно раз.

Дальше выяснилось, что проблема шире отказа в правах: дедупликации не было
вовсе, а экран «Работы» зовёт эту ручку в `useFocusEffect` — при каждом
открытии вкладки. Исполнитель с одним этапом в доработке получал новый push
себе же на каждый заход, просто переключая вкладки.

Механизм разовой отправки в проекте уже был — `enqueue_notification_once`
с устойчивым ключом; этот путь им не пользовался.
"""
import pathlib
from datetime import timedelta

import pytest

from app.core.timeutil import utc_now
from app.services.automation_reminder_outbox import reminder_outbox_id

ROUTE_SOURCE = (
    pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "rework_sla.py"
).read_text()


def rework_reminder_key(*args, **kwargs):
    """Ключ напоминания из маршрута — импорт отложен намеренно.

    На исходном коде функции нет, и импорт на уровне модуля ронял бы сбор
    тестов целиком. Тогда проверки по исходнику — про права и про обход
    дедупликации — не успевали бы сказать, что именно сломано.
    """
    from app.api.v1.rework_sla import rework_reminder_key as impl

    return impl(*args, **kwargs)


def _stage_id(n: int) -> str:
    return f"00000000-0000-0000-0000-00000000000{n}"


def test_key_does_not_depend_on_when_it_was_called():
    # Ровно та причина, по которой push дублировался на каждый заход.
    deadline = utc_now() + timedelta(hours=5)
    first = rework_reminder_key(_stage_id(1), deadline)
    second = rework_reminder_key(_stage_id(1), deadline + timedelta(minutes=37))
    assert first == second, "ключ меняется в течение дня — напоминание уйдёт повторно"


def test_key_separates_stages():
    deadline = utc_now() + timedelta(hours=5)
    assert rework_reminder_key(_stage_id(1), deadline) != rework_reminder_key(_stage_id(2), deadline)


def test_extended_deadline_is_a_new_reminder():
    # Срок продлили — это уже другой срок, и о нём надо напомнить заново.
    deadline = utc_now() + timedelta(hours=5)
    assert rework_reminder_key(_stage_id(1), deadline) != rework_reminder_key(
        _stage_id(1), deadline + timedelta(days=1)
    )


def test_key_maps_to_a_stable_outbox_row():
    deadline = utc_now() + timedelta(hours=5)
    key = rework_reminder_key(_stage_id(1), deadline)
    assert reminder_outbox_id(key) == reminder_outbox_id(key)


def test_route_asks_for_write_not_read():
    """Права проверяются по исходнику: ручка пишет, значит просит write."""
    check = ROUTE_SOURCE.split("async def check_rework_sla")[1].split("async def extend_rework_sla")[0]
    assert "write=True" in check, "ручка рассылает уведомления, а права просит на чтение"
    assert "write=False" not in check


def test_route_sends_through_the_deduplicating_path():
    source = ROUTE_SOURCE
    assert "enqueue_notification_once" in source
    # Прямая отправка обошла бы дедупликацию — ровно то, что и было.
    assert "ns.notify(" not in source, "остался путь в обход разовой отправки"


def test_answer_separates_nothing_to_send_from_already_sent():
    # Без этого повторный вызов выглядел бы как «просрочек нет».
    assert "already_sent" in ROUTE_SOURCE


@pytest.mark.asyncio
async def test_second_call_does_not_enqueue_again(db):
    from app.services.automation_reminder_outbox import enqueue_notification_once

    key = rework_reminder_key(_stage_id(1), utc_now() + timedelta(hours=5))
    payload = dict(
        dedupe_key=key,
        project_id="p1",
        user_id="u-contractor",
        notification_type="stage_review",
        title="SLA доработки завтра",
        body="Демонтаж до 2026-09-22",
        link_path="/stage/s1",
        return_to="/(contractor)/(tabs)/plan",
    )
    assert await enqueue_notification_once(db, **payload) is True
    await db.commit()
    # Второй заход на вкладку «Работы».
    assert await enqueue_notification_once(db, **payload) is False
    assert await enqueue_notification_once(db, **payload) is False
