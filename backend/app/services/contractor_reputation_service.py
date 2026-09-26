"""Что мы про исполнителя действительно знаем, а что только выглядит знанием.

`ContractorProfile.rating` объявлен как `Float, default=5.0`, и **ни одна
строка кода его не пишет**: модели отзывов в схеме нет вовсе. То есть
каждый исполнитель навсегда «★5», и заказчик при выборе читает это как
«его оценили другие заказчики на пятёрку». `jobs_done` — та же история:
`default=0`, никто не увеличивает.

Хуже показа было ранжирование. Подбор считал `score = profile.rating`, а
автоназначение заявки выбирало «лучшего» по тому же числу. Число у всех
одинаковое, поэтому при отсутствии совпадения по специализации побеждала
первая строка выборки — порядок в базе выдавался заказчику за подбор.

Колонки остаются: появится система отзывов — будет куда писать. Пока
источника нет, мы об этом говорим прямо, а не подставляем значение по
умолчанию вместо измерения.
"""
from __future__ import annotations

from typing import Any

#: Источники, из которых берётся оценка исполнителя.
#:
#: Пусто — в схеме нет ни отзывов, ни приёмок, влияющих на оценку.
#: Когда источник появится, его сюда добавляют, и `public_rating` начнёт
#: отдавать число. Проверка `test_rating_source_is_declared_not_assumed`
#: упадёт, если источник заведут, а это место забудут.
RATING_SOURCES: tuple[str, ...] = ()

#: То же для счётчика сданных объектов.
JOBS_DONE_SOURCES: tuple[str, ...] = ()

#: Вклад совпадения по специализации в подбор.
SPECIALTY_MATCH_WEIGHT = 2.0
#: Вклад совпадения по типу ремонта.
RENOVATION_TYPE_MATCH_WEIGHT = 1.0


def has_rating_source() -> bool:
    return bool(RATING_SOURCES)


def has_jobs_done_source() -> bool:
    return bool(JOBS_DONE_SOURCES)


def public_rating(profile: Any) -> float | None:
    """Оценка для показа заказчику — или `None`, если её никто не ставил.

    Отличить записанную пятёрку от пятёрки по умолчанию невозможно, поэтому
    пока нет источника — нет и числа.
    """
    if not has_rating_source():
        return None
    value = getattr(profile, "rating", None)
    return round(float(value), 1) if value is not None else None


def public_jobs_done(profile: Any) -> int | None:
    """Сколько объектов сдано — или `None`, если этого никто не считает."""
    if not has_jobs_done_source():
        return None
    value = getattr(profile, "jobs_done", None)
    return int(value) if value is not None else None


def _specialties(profile: Any) -> str:
    return getattr(profile, "specialties", None) or ""


def match_score(
    profile: Any,
    *,
    renovation_type: str | None = None,
    specialty: str | None = None,
) -> float:
    """Насколько исполнитель подходит под запрос — по тому, что известно.

    Оценка в расчёт не входит: её нет. Считаются только заявленные
    специализации, то есть то, что исполнитель о себе написал сам.
    """
    score = 0.0
    listed = _specialties(profile)
    if specialty and listed and specialty in listed:
        score += SPECIALTY_MATCH_WEIGHT
    if renovation_type and renovation_type in listed:
        score += RENOVATION_TYPE_MATCH_WEIGHT
    return round(score, 1)


def match_basis(
    profile: Any,
    *,
    renovation_type: str | None = None,
    specialty: str | None = None,
) -> str:
    """Почему этот исполнитель в выдаче — словами, а не баллом.

    Заказчику балл ни о чём не говорит, а «совпала специализация» — говорит.
    Когда совпадения нет, так и пишем: подбирать было не по чему.
    """
    listed = _specialties(profile)
    reasons: list[str] = []
    if specialty and listed and specialty in listed:
        reasons.append(f"специализация: {specialty}")
    if renovation_type and renovation_type in listed:
        reasons.append(f"тип ремонта: {renovation_type}")
    if reasons:
        return "Совпало — " + ", ".join(reasons)
    return "Совпадений по специализации нет — показан из общего списка"


def ranked(
    rows: list[tuple[Any, Any]],
    *,
    renovation_type: str | None = None,
    specialty: str | None = None,
) -> list[tuple[Any, Any, float]]:
    """Упорядочить исполнителей по совпадению, а при равенстве — предсказуемо.

    Раньше при равных баллах побеждал порядок выборки из базы: тот же запрос
    мог вернуть разных «лучших». Добираем сортировку по идентификатору —
    результат перестаёт зависеть от того, как лёг план запроса.
    """
    scored = [
        (profile, contractor, match_score(profile, renovation_type=renovation_type, specialty=specialty))
        for profile, contractor in rows
    ]
    scored.sort(key=lambda item: (-item[2], str(getattr(item[0], "id", ""))))
    return scored
