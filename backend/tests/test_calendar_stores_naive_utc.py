"""Календарь хранит наивный UTC — иначе PostgreSQL отказывается писать.

Колонки `calendar_items.start_at`, `end_at`, `reminder_at` объявлены как
`DateTime` без `timezone=True`, и в проекте принято хранить в них наивный UTC
(`app/core/timeutil.py`: «Call sites must not mix aware/naive»).

Два места нарушали это правило:

* проекция этапа в календарь собирала дату через `tzinfo=timezone.utc`;
* создание и правка события клали в колонку то, что прислал клиент, а клиент
  шлёт ISO-дату с поясом — `2026-09-25T09:00:00Z`.

На SQLite такие значения проходят, поэтому весь набор тестов молчал. На
PostgreSQL обе ручки отвечали 500:

    POST /api/v1/calendar/sync-stages/{id} → 500
    POST /api/v1/calendar                  → 500
    asyncpg.exceptions.DataError: invalid input for query argument $7
    (can't subtract offset-naive and offset-aware datetimes)

Найдено сплошным прогоном изменяющих маршрутов на отдельной базе PostgreSQL:
из 100 маршрутов это был единственный настоящий отказ.
"""
from datetime import date, datetime, timezone

from app.models.entities import Stage
from app.services import calendar_integrity_service as integrity
from app.services import calendar_mutation_service as mutation


def _stage(start: date, end: date | None = None) -> Stage:
    return Stage(
        id="cal-stage", project_id="cal-project", name="Демонтаж",
        sort_order=0, planned_start=start, planned_end=end,
    )


def test_stage_projection_is_naive():
    stage = _stage(date(2026, 9, 25), date(2026, 9, 30))
    assert integrity._stage_start(stage).tzinfo is None
    assert integrity._stage_end(stage).tzinfo is None


def test_stage_projection_keeps_the_same_wall_clock():
    # Правка о часовом поясе, а не о времени: девять утра и шесть вечера.
    stage = _stage(date(2026, 9, 25), date(2026, 9, 30))
    assert integrity._stage_start(stage) == datetime(2026, 9, 25, 9, 0)
    assert integrity._stage_end(stage) == datetime(2026, 9, 30, 18, 0)


def test_stage_without_end_falls_back_to_start():
    stage = _stage(date(2026, 9, 25))
    assert integrity._stage_end(stage) == datetime(2026, 9, 25, 18, 0)


def test_client_date_with_zone_becomes_naive_utc():
    # Ровно то, что шлёт клиент: ISO с «Z».
    aware = datetime(2026, 9, 25, 9, 0, tzinfo=timezone.utc)
    stored = mutation._for_storage(aware)
    assert stored is not None and stored.tzinfo is None
    assert stored == datetime(2026, 9, 25, 9, 0)


def test_offset_is_converted_not_dropped():
    # +03:00 — это 06:00 UTC, а не 09:00 без пояса.
    from datetime import timedelta

    moscow = datetime(2026, 9, 25, 9, 0, tzinfo=timezone(timedelta(hours=3)))
    assert mutation._for_storage(moscow) == datetime(2026, 9, 25, 6, 0)


def test_naive_input_is_left_alone():
    naive = datetime(2026, 9, 25, 9, 0)
    assert mutation._for_storage(naive) == naive


def test_absent_reminder_stays_absent():
    assert mutation._for_storage(None) is None


def test_every_stored_field_goes_through_the_converter():
    from pathlib import Path

    source = Path(mutation.__file__).read_text(encoding="utf-8")
    for field in ("start_at=_for_storage(", "end_at=_for_storage(", "reminder_at=_for_storage("):
        assert field in source, f"поле {field} снова пишется мимо преобразования"


def test_comparison_still_tolerates_both_shapes():
    # Сравнение «изменилось ли значение» обязано работать и со старыми
    # записями, где в базе может лежать дата с поясом.
    aware = datetime(2026, 9, 25, 9, 0, tzinfo=timezone.utc)
    naive = datetime(2026, 9, 25, 9, 0)
    assert integrity._same_value(aware, naive)
    assert mutation._utc(naive) == mutation._utc(aware)
