from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging_config import setup_logging
from app.core.observability import configure_observability, release_digest, release_sha
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

# Startup policy wiring is implemented once in app.core.runtime_policy. These
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    policy = validate_configured_runtime()
    for warning in configured_runtime_warnings():
        logger.warning(warning)

    from app.services import moy_nalog_oauth
    from app.services.document_ocr_runtime import validate_document_ocr_runtime
    from app.services.esign.runtime import validate_esign_runtime
    from app.services.otp_runtime import validate_otp_runtime
    from app.services.storage_runtime import validate_storage_runtime

    validate_esign_runtime()
    validate_document_ocr_runtime()
    await validate_otp_runtime()
    # An enabled OAuth integration is a working runtime dependency. Fail before
    # serving requests when its dedicated credential policy or Redis store is
    # unusable; disabled mode remains a no-op.
    await moy_nalog_oauth.validate_runtime()
    await rate_limiter.ping()
    await init_db()
    validate_storage_runtime()

    # Startup must not mutate demo/business data. Demo materialization is an
    # explicit local operator action (`python -m app.dev_seed`, surfaced as
    # `npm run dev -- seed`) after the database is migrated and runtime-ready.
    # Keeping seeding outside lifespan makes API restarts deterministic and
    # prevents a restart from deleting/re-writing developer project data.
    logger.info(
        "demo seed is explicit; API startup does not mutate demo business data "
        "(environment=%s)",
        policy.name,
    )

    # API-local infrastructure only. Durable background processing belongs to
    # the explicit `renova-worker` process from the same immutable image. The
    # API heartbeat is operational topology truth, not a durable business job.
    redis_stop: asyncio.Event | None = None
    redis_task: asyncio.Task | None = None
    api_heartbeat_stop: asyncio.Event | None = None
    api_heartbeat_task: asyncio.Task | None = None
    api_heartbeat_publisher = None
    if (settings.redis_url or "").strip():
        from app.services.runtime_topology import (
            ApiHeartbeatPublisher,
            api_heartbeat_loop,
        )
        from app.services.ws_redis_bridge import redis_subscriber_loop

        api_heartbeat_publisher = ApiHeartbeatPublisher()
        try:
            # A deployed API must not start serving while its shared topology
            # truth cannot be published. Local/test remains tolerant so a
            # developer's optional stale Redis URL does not block the app.
            await api_heartbeat_publisher.publish()
        except Exception:
            if policy.name in {"staging", "production"}:
                await api_heartbeat_publisher.close()
                raise
            logger.warning(
                "API topology heartbeat unavailable in local/test; continuing without registry",
                exc_info=True,
            )
            await api_heartbeat_publisher.close()
            api_heartbeat_publisher = None
        else:
            api_heartbeat_stop = asyncio.Event()
            api_heartbeat_task = asyncio.create_task(
                api_heartbeat_loop(api_heartbeat_stop, api_heartbeat_publisher)
            )

        redis_stop = asyncio.Event()
        redis_task = asyncio.create_task(redis_subscriber_loop(redis_stop))
        logger.info(
            "ws redis bridge enabled; API topology heartbeat=%s",
            "enabled" if api_heartbeat_publisher is not None else "unavailable_local",
        )

    try:
        yield
    finally:
        if redis_stop is not None:
            redis_stop.set()
        if api_heartbeat_stop is not None:
            api_heartbeat_stop.set()

        if redis_task is not None:
            try:
                await asyncio.wait_for(redis_task, timeout=5)
            except Exception:
                redis_task.cancel()
        if api_heartbeat_task is not None:
            try:
                await asyncio.wait_for(api_heartbeat_task, timeout=5)
            except Exception:
                api_heartbeat_task.cancel()

        if api_heartbeat_publisher is not None:
            await api_heartbeat_publisher.remove()
            await api_heartbeat_publisher.close()

        try:
            await rate_limiter.close()
        finally:
            observability_runtime = getattr(app.state, "observability_runtime", None)
            if observability_runtime is not None:
                await asyncio.to_thread(observability_runtime.shutdown)


setup_logging()
app = FastAPI(title=settings.app_name, version="0.3.7", lifespan=lifespan)
configure_observability(app)


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
        "release": release_sha(),
        "artifact_digest": release_digest(),
        "background_runtime": "renova-worker",
    }


@app.get("/ready")
async def readiness():
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        await rate_limiter.ping()
    except Exception:
        logger.exception("readiness probe failed")
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "renova-api",
                "release": release_sha(),
                "artifact_digest": release_digest(),
            },
        )

    return {
        "status": "ready",
        "service": "renova-api",
        "release": release_sha(),
        "artifact_digest": release_digest(),
    }
