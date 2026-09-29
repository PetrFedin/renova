"""Блокировка строк там, где движок её поддерживает — и только там.

`SELECT ... FOR UPDATE` защищает от гонок: два одновременных решения по одной
записи должны выстроиться в очередь, а не выполниться оба. По коду это было
записано так:

    try:
        query = query.with_for_update()
    except Exception:
        pass

Пятьдесят два места из шестидесяти трёх. Замысел понятен — SQLite блокировок
строк не умеет, и на локальном стенде запрос не должен падать. Но глухой
`except Exception` снимает защиту при **любой** ошибке, включая те, что
возможны на PostgreSQL: неподдерживаемая комбинация с внешним соединением,
изменение поведения в новой версии SQLAlchemy. Блокировка исчезла бы молча, а
код пошёл бы дальше как ни в чём не бывало — ровно та гонка, от которой он
защищается.

Здесь пропуск сделан осознанным: блокировка не берётся только на движках, где
её нет. Всё остальное падает громко, как и должно.

Проверено на обоих движках: `get_bind().dialect.name` даёт `sqlite` и
`postgresql` соответственно.
"""

from __future__ import annotations

from typing import TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

_Q = TypeVar("_Q")

#: Движки без блокировок строк. SQLite сериализует запись на уровне файла,
#: поэтому гонки, от которых защищает FOR UPDATE, там и не возникают в том же
#: виде — но и выстроить очередь нечем.
_NO_ROW_LOCKS = frozenset({"sqlite"})


def supports_row_locks(db: AsyncSession) -> bool:
    """Умеет ли текущий движок блокировать строки."""
    try:
        dialect = db.get_bind().dialect.name
    except Exception:
        # Сессия без привязанного движка встречается в тестах-заглушках.
        # Для них безопаснее считать, что блокировок нет, чем упасть.
        return False
    return dialect not in _NO_ROW_LOCKS


def lock_rows(query: _Q, db: AsyncSession) -> _Q:
    """Добавить `FOR UPDATE`, если движок это умеет.

    Замена для `try: q = q.with_for_update() except Exception: pass`.
    Отличие в том, что настоящая ошибка больше не проглатывается.
    """
    if not supports_row_locks(db):
        return query
    return query.with_for_update()  # type: ignore[attr-defined]
