"""Bounded runtime capacity signals for production load evidence.

This module deliberately reports only metrics the application can measure
reliably. It does not invent provider-level CPU/memory/Redis utilization.
"""
from __future__ import annotations

import time
from typing import Any

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import engine


def _safe_pool_int(pool: object, name: str) -> int | None:
    value = getattr(pool, name, None)
    if not callable(value):
        return None
    try:
        return int(value())
    except Exception:
        return None


def database_pool_snapshot(pool: object | None = None) -> dict[str, Any]:
    """Return per-API-process SQLAlchemy pool pressure without private internals."""
    current = pool or engine.sync_engine.pool
    checked_out = _safe_pool_int(current, "checkedout")
    pool_size = _safe_pool_int(current, "size")
    checked_in = _safe_pool_int(current, "checkedin")
    current_overflow = _safe_pool_int(current, "overflow")
    postgres_pool = not settings.database_url.strip().lower().startswith("sqlite")
    supported = postgres_pool and checked_out is not None and pool_size is not None

    configured_capacity = (
        settings.db_pool_size + settings.db_max_overflow if postgres_pool else None
    )
    utilization_percent = None
    if supported and configured_capacity and configured_capacity > 0:
        utilization_percent = round(100.0 * checked_out / configured_capacity, 2)

    return {
        "scope": "api_process",
        "supported": supported,
        "configured_pool_size": settings.db_pool_size if postgres_pool else None,
        "configured_max_overflow": settings.db_max_overflow if postgres_pool else None,
        "configured_connection_capacity": configured_capacity,
        "pool_timeout_seconds": settings.db_pool_timeout_sec if postgres_pool else None,
        "checked_out": checked_out,
        "checked_in": checked_in,
        "current_overflow": current_overflow,
        "utilization_percent": utilization_percent,
    }


async def _database_probe(db: AsyncSession) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        return {
            "available": False,
            "probe_latency_ms": None,
        }
    return {
        "available": True,
        "probe_latency_ms": round((time.perf_counter() - started) * 1000.0, 2),
    }


async def _redis_probe(redis_client: Redis | None = None) -> dict[str, Any]:
    redis_url = (settings.redis_url or "").strip()
    configured = redis_client is not None or bool(redis_url)
    if not configured:
        return {
            "configured": False,
            "available": False,
            "probe_latency_ms": None,
        }

    client = redis_client
    owns_client = False
    if client is None:
        client = Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=2.0,
            socket_timeout=2.0,
        )
        owns_client = True
    started = time.perf_counter()
    try:
        ok = bool(await client.ping())
    except Exception:
        return {
            "configured": True,
            "available": False,
            "probe_latency_ms": None,
        }
    finally:
        if owns_client and client is not None:
            await client.aclose()
    return {
        "configured": True,
        "available": ok,
        "probe_latency_ms": round((time.perf_counter() - started) * 1000.0, 2),
    }


async def capacity_runtime_snapshot(
    db: AsyncSession,
    *,
    worker_pool: dict[str, Any] | None = None,
    redis_client: Redis | None = None,
) -> dict[str, Any]:
    """Build a secret-free capacity snapshot suitable for release evidence."""
    from app.services.runtime_topology import worker_pool_snapshot

    workers = worker_pool
    if workers is None:
        workers = await worker_pool_snapshot(redis_client)

    return {
        "contract_version": 1,
        "database": {
            "probe": await _database_probe(db),
            "pool": database_pool_snapshot(),
        },
        "redis": await _redis_probe(redis_client),
        "worker_pool": workers,
        "interpretation": {
            "database_pool_scope": "one_api_process",
            "redis_utilization_available": False,
            "provider_cpu_memory_available": False,
        },
    }
