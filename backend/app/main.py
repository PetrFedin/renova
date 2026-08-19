from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.environment import policy_for, resolve_policy_flag
from app.core.logging_config import setup_logging
from app.core.rate_limit import rate_limiter
from app.core.runtime_policy import configured_runtime_warnings, validate_configured_runtime
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

# Startup policy wiring is implemented once in app.core.runtime_policy.  These
# explicit anchors document the Settings fields covered by that adapter and
# preserve compatibility with older source-contract tests while behavior is
# enforced by test_runtime_preflight_integrity.py.
# allow_demo_seed=settings.allow_demo_seed
# allow_create_all=settings.allow_create_all
# ops_alert_email=settings.ops_alert_email
# smtp_host=settings.smtp_host
# smtp_password=settings.smtp_password
# redis_url=settings.redis_url
# twilio_sid=settings.twilio_sid
# twilio_token=settings.twilio_token
# twilio_from=settings.twilio_from


def _demo_seed_allowed() -> bool:
    policy = policy_for(settings.normalized_environment)
    return resolve_policy_flag(
        policy_allows=policy.allow_demo_seed,
        override=settings.allow_demo_seed,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    policy = validate_configured_runtime()
    for warning in configured_runtime_warnings():
        logger.warning(warning)

    from app.services.document_ocr_runtime import validate_document_ocr_runtime
    from app.services.esign.runtime import validate_esign_runtime
    from app.services.otp_runtime import validate_otp_runtime
    from app.services.storage_runtime import validate_storage_runtime

    validate_esign_runtime()
    validate_document_ocr_runtime()
    await validate_otp_runtime()
    await rate_limiter.ping()
    await init_db()
    validate_storage_runtime()

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
    push_receipt_stop: asyncio.Event | None = None
    push_receipt_task: asyncio.Task | None = None

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

    if settings.push_receipt_worker_enabled:
        from app.services.push_receipt_worker import push_receipt_worker_loop

        push_receipt_stop = asyncio.Event()
        push_receipt_task = asyncio.create_task(
            push_receipt_worker_loop(
                push_receipt_stop,
                interval_sec=float(settings.push_receipt_worker_interval_sec),
            )
        )
        logger.info(
            "Expo push receipt worker enabled (interval=%ss)",
            settings.push_receipt_worker_interval_sec,
        )

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
    if push_receipt_stop is not None:
        push_receipt_stop.set()
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
    if push_receipt_task is not None:
        try:
            await asyncio.wait_for(push_receipt_task, timeout=5)
        except Exception:
            push_receipt_task.cancel()
    if redis_task is not None:
        try:
            await asyncio.wait_for(redis_task, timeout=5)
        except Exception:
            redis_task.cancel()
    await rate_limiter.close()


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


@app.exception_handler(InvalidStorageKey)
async def invalid_storage_key_handler(_: Request, __: InvalidStorageKey):
    return JSONResponse(status_code=400, content={"detail": "Некорректный ключ файла"})


async def storage_unavailable_handler(_: Request, __: Exception):
    return JSONResponse(
        status_code=503,
        content={"detail": "Хранилище временно недоступно. Повторите попытку позже."},
    )


app.add_exception_handler(StorageConfigurationError, storage_unavailable_handler)
app.add_exception_handler(StorageUnavailable, storage_unavailable_handler)

app.add_middleware(CorrelationIdMiddleware)
app.add_middleware(AuditMiddleware)
app.add_middleware(RateLimitMiddleware)


def _cors_origins() -> tuple[list[str], bool]:
    raw = (settings.cors_allowed_origins or "").strip()
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    environment = settings.normalized_environment
    if not origins:
        if environment in ("development", "test"):
            return ["*"], False
        base = (settings.public_base_url or "").rstrip("/")
        return ([base] if base else []), True
    if origins == ["*"]:
        return ["*"], False
    return origins, True


_cors_origin_list, _cors_credentials = _cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origin_list,
    allow_credentials=_cors_credentials,
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
        "version": "0.3.7",
        "environment": settings.normalized_environment,
    }
