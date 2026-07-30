"""Async SQLAlchemy session."""
from collections.abc import AsyncGenerator
import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.environment import policy_for, resolve_policy_flag
from app.db.base import Base

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


def _create_all_allowed() -> bool:
    policy = policy_for(settings.normalized_environment)
    return resolve_policy_flag(
        policy_allows=policy.allow_create_all,
        override=settings.allow_create_all,
    )


async def init_db() -> None:
    """Initialize permitted local schemas and repair legacy receipt truth.

    `ALLOW_CREATE_ALL` may disable local create_all, but can never enable it in
    staging or production. Those environments must apply Alembic before start.
    The receipt repair is idempotent and runs only after the schema is ready.
    """
    from app.db.sqlite_compat import ensure_os_schema

    if settings.database_url.strip().lower().startswith("sqlite"):
        ensure_os_schema()

    if _create_all_allowed():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    else:
        logger.info(
            "init_db: create_all skipped (environment=%s) — use alembic upgrade head",
            settings.normalized_environment,
        )

    from app.services.fns.receipt_truth_repair import repair_legacy_receipt_truth

    async with SessionLocal() as db:
        repaired = await repair_legacy_receipt_truth(db)
        await db.commit()
    if repaired["receipts_repaired"] or repaired["expenses_repaired"]:
        logger.warning(
            "legacy receipt truth repaired receipts=%s expenses=%s",
            repaired["receipts_repaired"],
            repaired["expenses_repaired"],
        )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
