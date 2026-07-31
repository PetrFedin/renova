from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.environment import (
    collect_warnings,
    policy_for,
    resolve_policy_flag,
    validate_runtime_settings,
)
from app.core.logging_config import setup_logging
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.audit import AuditMiddleware
from app.middleware.correlation import CorrelationIdMiddleware
from app.db.session import init_db, SessionLocal
from app.services.storage_service import (
    InvalidStorageKey,
    StorageConfigurationError,
    StorageUnavailable,
)
import app.models.entities  # noqa: F401
import app.models.work_schedule  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.outbox_runtime  # noqa: F401
import app.models.webhook_runtime  # noqa: F401

logger = logging.getLogger(__name__)


def _demo_seed_allowed() -> bool:
    policy = policy_for(settings.normalized_environment)
    return resolve_policy_flag(
        policy_allows=policy.allow_demo_seed,
        override=settings.allow_demo_seed,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    policy = validate_runtime_settings(
        environment=settings.environment,
        database_url=settings.database_url,
        public_base_url=settings.public_base_url,
        secret_key=settings.secret_key,
        auth_allow_header_user_id=settings.auth_allow_header_user_id,
        allow_create_all=settings.allow_create_all,
        allow_demo_seed=settings.allow_demo_seed,
        ops_alert_email=settings.ops_alert_email,
        smtp_host=settings.smtp_host,
        smtp_port=settings.smtp_port,
        smtp_user=settings.smtp_user,
        smtp_password=settings.smtp_password,
        smtp_from=settings.smtp_from,
        redis_url=settings.redis_url,
        twilio_sid=settings.twilio_sid,
        twilio_token=settings.twilio_token,
        twilio_from=settings.twilio_from,
    )
    for warning in collect_warnings(
        environment=settings.environment,
        database_url=settings.database_url,
        secret_key=settings.secret_key,
        kontur_mode=settings.kontur_mode,
        kontur_api_key=settings.kontur_api_key,
        yookassa_shop_id=settings.yookassa_shop_id,
        yookassa_secret=settings.yookassa_secret,
        esign_webhook_secret=settings.esign_webhook_secret,
        yookassa_webhook_secret=settings.yookassa_webhook_secret,
        ops_alert_email=settings.ops_alert_email,
        smtp_host=settings.smtp_host,
        redis_url=settings.redis_url,
        twilio_sid=settings.twilio_sid,
        twilio_token=settings.twilio_token,
        twilio_from=settings.twilio_from,
    ):
        logger.warning(warning)

    from app.services.document_ocr_runtime import validate_document_ocr_runtime
    from app.services.esign.runtime import validate_esign_runtime
    from app.services.otp_runtime import validate_otp_runtime

    validate_esign_runtime()
    validate_document_ocr_runtime()
    await validate_otp_runtime()
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

    reminder_stop: asyncio.Event | None = None
    reminder_task: asyncio.Task | None = None
    redis_stop: asyncio.Event | None = None
    redis_task: asyncio.Task | None = None
    outbox_stop: asyncio.Event | None = None
    outbox_task: asyncio.Task | None = None

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

    from app.services.outbox_worker import outbox_worker_loop

    outbox_stop = asyncio.Event()
    outbox_task = asyncio.create_task(outbox_worker_loop(outbox_stop, interval_sec=15.0))
    logger.info("domain outbox worker enabled")

    if (settings.redis_url or "").strip():
        from app.services.ws_redis_bridge import redis_subscriber_loop

        redis_stop = asyncio.Event()
        redis_task = asyncio.create_task(redis_subscriber_loop(redis_stop))
        logger.info("ws redis bridge enabled")

    yield

    if reminder_stop is not None:
        reminder_stop.set()
    if outbox_stop is not None:
        outbox_stop.set()
    if redis_stop is not None:
        redis_stop.set()
    if reminder_task is not None:
        try:
            await asyncio.wait_for(reminder_task, timeout=5)
        except Exception:
            reminder_task.cancel()
    if outbox_task is not None:
        try:
            await asyncio.wait_for(outbox_task, timeout=5)
        except Exception:
            outbox_task.cancel()
    if redis_task is not None:
        try:
            await asyncio.wait_for(redis_task, timeout=5)
        except Exception:
            redis_task.cancel()


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

app = FastAPI(title=settings.app_name, version="0.3.7", lifespan=lifespan)

# CORS: explicit allowlist in staging/production; localhost defaults only for dev/test.
_origins = [item.strip() for item in settings.cors_allowed_origins.split(",") if item.strip()]
if not _origins and settings.normalized_environment in ("development", "test"):
    _origins = [
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:19006",
        "http://127.0.0.1:19006",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Correlation-ID"],
)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(AuditMiddleware)
app.add_middleware(CorrelationIdMiddleware)
app.include_router(api_router)
if FastAPIInstrumentor is not None:
    try:
        FastAPIInstrumentor.instrument_app(app)
    except Exception:
        pass


@app.exception_handler(StorageUnavailable)
async def storage_unavailable_handler(_request: Request, exc: StorageUnavailable):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(StorageConfigurationError)
async def storage_configuration_handler(_request: Request, exc: StorageConfigurationError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(InvalidStorageKey)
async def invalid_storage_key_handler(_request: Request, exc: InvalidStorageKey):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health")
async def health():
    return {"ok": True, "environment": settings.normalized_environment}
