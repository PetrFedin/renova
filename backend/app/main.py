from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging_config import setup_logging
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.audit import AuditMiddleware
from app.db.session import init_db, SessionLocal
from app.services.seed_demo import ensure_demo_users
from app.services.seed_articles import seed_articles
import app.models.entities  # noqa: F401 — регистрация моделей


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    from app.services.storage_service import ensure_bucket
    ensure_bucket()
    async with SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)
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
    return {"status": "ok", "service": "renova-api", "version": "0.2.0"}
