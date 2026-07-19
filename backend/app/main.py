from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.environment import (
    collect_warnings,
    policy_for,
    validate_runtime_settings,
)
from app.core.logging_config import setup_logging
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.audit import AuditMiddleware
from app.db.session import init_db, SessionLocal
import app.models.entities  # noqa: F401
import app.models.work_schedule  # noqa: F401
import app.models.project_documents  # noqa: F401

logger = logging.getLogger(__name__)


def _demo_seed_allowed() -> bool:
    policy = policy_for(settings.normalized_environment)
    if settings.allow_demo_seed is not None:
        return bool(settings.allow_demo_seed)
    return policy.allow_demo_seed


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Hard fail до приёма трафика при неверном профиле
    policy = validate_runtime_settings(
        environment=settings.environment,
        database_url=settings.database_url,
        public_base_url=settings.public_base_url,
        secret_key=settings.secret_key,
    )
    for warning in collect_warnings(
        environment=settings.environment,
        database_url=settings.database_url,
        secret_key=settings.secret_key,
        kontur_mode=settings.kontur_mode,
        kontur_api_key=settings.kontur_api_key,
        yookassa_shop_id=settings.yookassa_shop_id,
        yookassa_secret=settings.yookassa_secret,
    ):
        logger.warning(warning)

    await init_db()
    from app.services.storage_service import ensure_bucket
    ensure_bucket()

    if _demo_seed_allowed():
        from app.services.seed_demo import ensure_demo_users
        from app.services.seed_articles import seed_articles

        async with SessionLocal() as db:
            await ensure_demo_users(db)
            await seed_articles(db)
        logger.info("demo seed applied (environment=%s)", policy.name)
    else:
        logger.info("demo seed skipped (environment=%s)", policy.name)

    ocr_stop: asyncio.Event | None = None
    ocr_task: asyncio.Task | None = None
    reminder_stop: asyncio.Event | None = None
    reminder_task: asyncio.Task | None = None
    if (settings.document_ocr_mode or "sync").strip().lower() == "async":
        from app.services.document_ocr_worker import ocr_worker_loop

        ocr_stop = asyncio.Event()
        ocr_task = asyncio.create_task(
            ocr_worker_loop(ocr_stop, interval_sec=float(settings.document_ocr_worker_interval_sec))
        )
        logger.info("OCR async worker enabled")

    if settings.automation_reminders_enabled:
        from app.services.automation_reminders_worker import automation_reminders_loop

        reminder_stop = asyncio.Event()
        reminder_task = asyncio.create_task(
            automation_reminders_loop(
                reminder_stop,
                interval_sec=float(settings.automation_reminders_interval_sec),
            )
        )
        logger.info(
            "automation reminders enabled (interval=%ss)",
            settings.automation_reminders_interval_sec,
        )

    yield

    if ocr_stop is not None:
        ocr_stop.set()
    if reminder_stop is not None:
        reminder_stop.set()
    if reminder_task is not None:
        try:
            await asyncio.wait_for(reminder_task, timeout=5)
        except Exception:
            reminder_task.cancel()
    if ocr_task is not None:
        try:
            await asyncio.wait_for(ocr_task, timeout=5)
        except Exception:
            ocr_task.cancel()


setup_logging()
try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
except Exception:
    FastAPIInstrumentor = None
if settings.sentry_dsn:
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=settings.sentry_dsn, traces_sample_rate=0.1)
    except Exception:
        pass

app = FastAPI(title=settings.app_name, version="0.2.0", lifespan=lifespan)

app.add_middleware(AuditMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FastAPIInstrumentor:
    try:
        FastAPIInstrumentor.instrument_app(app)
    except Exception:
        pass
app.include_router(api_router)
from app.api.v1 import ws
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "renova-api",
        "version": "0.2.0",
        "environment": settings.normalized_environment,
    }
