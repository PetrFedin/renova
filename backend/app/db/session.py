"""Async SQLAlchemy session."""
from collections.abc import AsyncGenerator
import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.environment import policy_for
from app.db.base import Base

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


def _create_all_allowed() -> bool:
    policy = policy_for(settings.normalized_environment)
    if settings.allow_create_all is not None:
        return bool(settings.allow_create_all)
    return policy.allow_create_all


async def init_db() -> None:
    """Инициализация схемы.

    create_all — только development/test (или явный ALLOW_CREATE_ALL=true).
    staging/production обязаны идти через Alembic до старта процесса.
    """
    from app.db.sqlite_compat import ensure_os_schema

    if settings.database_url.strip().lower().startswith("sqlite"):
        ensure_os_schema()

    if not _create_all_allowed():
        logger.info(
            "init_db: create_all skipped (environment=%s) — use alembic upgrade head",
            settings.normalized_environment,
        )
        return

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
