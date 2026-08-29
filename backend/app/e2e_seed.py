"""Explicit deterministic seed bootstrap for isolated Playwright runtimes.

This module is deliberately narrower than ``app.dev_seed``: it only runs in the
``test`` environment against SQLite. API startup remains side-effect free while
browser/API E2E suites can opt into the canonical demo fixture after readiness.
"""
from __future__ import annotations

import asyncio
import json
import sys

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users


async def run() -> int:
    if settings.normalized_environment != "test":
        print("e2e seed refused: ENVIRONMENT must be test", file=sys.stderr)
        return 2
    if not settings.database_url.strip().lower().startswith("sqlite"):
        print("e2e seed refused: DATABASE_URL must be isolated SQLite", file=sys.stderr)
        return 2

    async with SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)

    print(
        json.dumps(
            {
                "ok": True,
                "environment": "test",
                "seed": "canonical_demo",
                "scope": "playwright",
                "idempotent": True,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
