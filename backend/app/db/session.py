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
    """Initialize permitted schemas and run idempotent truth repairs."""
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

    from app.services.document_ocr_truth_repair import repair_legacy_ocr_truth
    from app.services.fns.receipt_truth_repair import repair_legacy_receipt_truth
    from app.services.moy_nalog_truth_repair import repair_legacy_moy_nalog_truth

    async with SessionLocal() as db:
        receipts = await repair_legacy_receipt_truth(db)
        moy_nalog = await repair_legacy_moy_nalog_truth(db)
        ocr = await repair_legacy_ocr_truth(db)
        await db.commit()

    if receipts["receipts_repaired"] or receipts["expenses_repaired"]:
        logger.warning(
            "legacy receipt truth repaired receipts=%s expenses=%s",
            receipts["receipts_repaired"],
            receipts["expenses_repaired"],
        )
    if moy_nalog["users_repaired"]:
        logger.warning(
            "legacy Moy Nalog truth repaired users=%s preserved=%s",
            moy_nalog["users_repaired"],
            moy_nalog["connections_preserved"],
        )
    if ocr["suggestions_repaired"] or ocr["jobs_marked_unavailable"]:
        logger.warning(
            "legacy OCR truth repaired suggestions=%s unavailable=%s",
            ocr["suggestions_repaired"],
            ocr["jobs_marked_unavailable"],
        )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
