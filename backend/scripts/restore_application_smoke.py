"""Boot the Renova ASGI lifespan against an isolated restored PostgreSQL database.

This is CI/DR verification, not a production restore command. It proves that the
application can start and its health/readiness probes can execute with the
restored schema/data without advertising provider-managed backup guarantees.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.main import app


class RestoreApplicationSmokeError(RuntimeError):
    pass


def _validate_target() -> str:
    if settings.normalized_environment != "test":
        raise RestoreApplicationSmokeError("restore application smoke requires ENVIRONMENT=test")

    database_url = settings.database_url.strip()
    if not database_url.startswith("postgresql+asyncpg://"):
        raise RestoreApplicationSmokeError(
            "restore application smoke requires PostgreSQL/asyncpg DATABASE_URL"
        )

    database_name = make_url(database_url).database or ""
    expected = (os.environ.get("RESTORE_DB") or "renova_restore").strip()
    source = (os.environ.get("SOURCE_DB") or "renova").strip()
    if not expected or database_name != expected:
        raise RestoreApplicationSmokeError(
            f"DATABASE_URL must target isolated restore database {expected!r}"
        )
    if database_name == source:
        raise RestoreApplicationSmokeError("restore smoke must never target the source database")
    if settings.allow_demo_seed is not False:
        raise RestoreApplicationSmokeError("restore smoke requires ALLOW_DEMO_SEED=false")
    if settings.allow_create_all is not False:
        raise RestoreApplicationSmokeError("restore smoke requires ALLOW_CREATE_ALL=false")
    return database_name


async def _run(record_path: Path | None) -> None:
    database_name = _validate_target()

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://restore-smoke") as client:
            health = await client.get("/health")
            ready = await client.get("/ready")

    if health.status_code != 200:
        raise RestoreApplicationSmokeError(
            f"/health failed status={health.status_code} body={health.text[:200]}"
        )
    if ready.status_code != 200:
        raise RestoreApplicationSmokeError(
            f"/ready failed status={ready.status_code} body={ready.text[:200]}"
        )

    health_body = health.json()
    ready_body = ready.json()
    if health_body.get("status") != "ok" or health_body.get("service") != "renova-api":
        raise RestoreApplicationSmokeError(f"unexpected /health payload: {health_body}")
    if ready_body.get("status") != "ready" or ready_body.get("service") != "renova-api":
        raise RestoreApplicationSmokeError(f"unexpected /ready payload: {ready_body}")

    record = {
        "application_health_verified": True,
        "database": database_name,
        "environment": settings.normalized_environment,
        "health_status": health_body["status"],
        "ready_status": ready_body["status"],
        "service": ready_body["service"],
    }
    if record_path is not None:
        record_path.parent.mkdir(parents=True, exist_ok=True)
        record_path.write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(record, sort_keys=True))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    asyncio.run(_run(args.record))
