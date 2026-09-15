"""Explicit, local-only deterministic seed command for Renova development."""
from __future__ import annotations

import asyncio
import json
import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.environment import policy_for, resolve_policy_flag
from app.db.migration_guard import assert_database_at_head
from app.db.session import SessionLocal, engine
from app.models.entities import Project, User
from app.services.seed_articles import seed_articles
from app.services.seed_demo import DEMO_PHONES, ensure_demo_users
from app.services.seed_showcase import ensure_showcase_project


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
    showcase: dict[str, object] = {}
    async with SessionLocal() as db:
        # Reconciliation is deliberately repeated: pristine databases get both
        # canonical demo projects on the first operator seed command.
        await ensure_demo_users(db)
        await ensure_demo_users(db)
        await seed_articles(db)

        customer = (
            await db.execute(select(User).where(User.phone == DEMO_PHONES["customer"]).limit(1))
        ).scalar_one()
        contractor = (
            await db.execute(select(User).where(User.phone == DEMO_PHONES["contractor"]).limit(1))
        ).scalar_one()
        projects = list(
            (
                await db.execute(
                    select(Project).where(Project.customer_id == customer.id).order_by(Project.created_at.asc())
                )
            ).scalars().all()
        )
        apartment = next((p for p in projects if p.property_type != "house"), projects[0] if projects else None)
        if apartment is None:
            raise RuntimeError("canonical demo apartment missing after seed")
        for project in projects:
            if not project.contractor_id:
                project.contractor_id = contractor.id
        await db.commit()
        showcase = await ensure_showcase_project(
            db,
            project_id=apartment.id,
            customer_id=customer.id,
            contractor_id=contractor.id,
        )

    print(
        json.dumps(
            {
                "ok": True,
                "environment": policy.name,
                "seed": "canonical_demo",
                "idempotent": True,
                "full_project_set": True,
                "showcase": showcase,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
