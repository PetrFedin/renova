"""Блокировка строк не исчезает молча.

`SELECT ... FOR UPDATE` защищает от гонок: два одновременных решения по одной
записи должны выстроиться в очередь. По коду это было записано так, в
пятидесяти двух местах из шестидесяти трёх:

    try:
        query = query.with_for_update()
    except Exception:
        pass

Замысел понятен — SQLite блокировок строк не умеет. Но глухой `except
Exception` снимает защиту при ЛЮБОЙ ошибке, включая возможные на PostgreSQL:
неподдерживаемая комбинация с внешним соединением, изменение поведения в новой
версии SQLAlchemy. Блокировка исчезла бы молча, и код пошёл бы дальше — ровно
та гонка, от которой он защищается.

Отдельно стоит сказать, чего здесь НЕ чинится. Аудит сообщил, что
одновременные `approve` и `reject` доп. работ оба отвечают 200. Проверено на
настоящем PostgreSQL: `reject` получает 404, `approve` 200, итог один —
`approved`. То есть на боевом движке гонка сериализуется правильно, а находка
была артефактом SQLite-стенда. Чинится не она, а молчаливость пропуска.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.locking import lock_rows, supports_row_locks
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import Project

BACKEND = Path(__file__).resolve().parents[1]

#: Старая форма: блокировка, обёрнутая в глухой except.
SILENT_WRAPPER = re.compile(
    r"try:\n\s*(\w[\w.]*) = \1\.with_for_update\(\)\n\s*except Exception:\n\s*pass"
)


def test_no_silent_wrapper_remains_in_application_code():
    found: list[str] = []
    listing = subprocess.run(
        ["grep", "-rl", "with_for_update", str(BACKEND / "app")],
        capture_output=True,
        text=True,
    ).stdout.split()

    for path in listing:
        if path.endswith("app/db/locking.py"):
            # В этом файле старая форма приведена в документации — как описание
            # того, что заменено, а не как код.
            continue
        try:
            source = Path(path).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if SILENT_WRAPPER.search(source):
            found.append(path)

    assert found == [], f"блокировка снова снимается молча: {found}"


def test_the_helper_is_used_everywhere_locks_are_taken():
    """Страховка: места не должны просто лишиться блокировки."""
    uses = subprocess.run(
        ["grep", "-rho", "lock_rows(", str(BACKEND / "app")],
        capture_output=True,
        text=True,
    ).stdout.count("lock_rows(")
    assert uses >= 50, f"помощник используется лишь в {uses} местах — часть блокировок пропала"


@pytest.mark.asyncio
async def test_sqlite_skips_the_lock_without_failing():
    """На движке без блокировок строк запрос обязан работать."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        assert supports_row_locks(db) is False

        query = lock_rows(select(Project).where(Project.id == "none"), db)
        # Запрос должен выполниться, а не упасть.
        assert (await db.execute(query)).scalars().all() == []
        # ...и FOR UPDATE в нём не появился.
        assert "FOR UPDATE" not in str(query).upper()
    await engine.dispose()


@pytest.mark.asyncio
async def test_a_backend_with_row_locks_actually_gets_for_update():
    """Главное: где блокировка возможна, она обязана появиться в запросе."""

    class _PostgresLike:
        """Сессия, притворяющаяся PostgreSQL: проверяем выбор, а не движок."""

        def get_bind(self):
            class _Bind:
                class dialect:
                    name = "postgresql"

            return _Bind()

    db = _PostgresLike()
    assert supports_row_locks(db) is True

    query = lock_rows(select(Project).where(Project.id == "x"), db)
    assert "FOR UPDATE" in str(query).upper(), (
        "на движке с блокировками FOR UPDATE не добавился"
    )


@pytest.mark.asyncio
async def test_a_session_without_a_bind_does_not_crash():
    """Заглушки в тестах не должны ронять рабочий код."""

    class _NoBind:
        def get_bind(self):
            raise RuntimeError("no bind")

    db = _NoBind()
    assert supports_row_locks(db) is False
    query = lock_rows(select(Project), db)
    assert "FOR UPDATE" not in str(query).upper()
