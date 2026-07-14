from contextlib import asynccontextmanager
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

    yield


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
