"""Explicit, local-only deterministic seed command for Renova development."""
from __future__ import annotations

import asyncio
import json
import sys

from app.core.config import settings
from app.core.environment import policy_for, resolve_policy_flag
from app.db.migration_guard import assert_database_at_head
from app.db.session import SessionLocal, engine
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users


async def run() -> int:
    policy = policy_for(settings.normalized_environment)
    allowed = resolve_policy_flag(
        policy_allows=policy.allow_demo_seed,
        override=settings.allow_demo_seed,
    )
    if policy.name != "development" or not allowed:
        print(
            "dev seed refused: ENVIRONMENT must be development and ALLOW_DEMO_SEED=true",
            file=sys.stderr,
        )
        return 2

    await assert_database_at_head(engine)
    async with SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)

    print(
        json.dumps(
            {
                "ok": True,
                "environment": policy.name,
                "seed": "canonical_demo",
                "idempotent": True,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
