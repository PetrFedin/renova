"""Explicit deterministic seed bootstrap for isolated Playwright runtimes.

This module is deliberately narrower than ``app.dev_seed``: it only runs in the
``test`` environment against SQLite. API startup remains side-effect free while
browser/API E2E suites can opt into the canonical demo fixture after readiness.
"""
from __future__ import annotations

import asyncio
import json
import sys

from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.entities import Project, User
from app.services.seed_articles import seed_articles
from app.services.seed_demo import DEMO_PHONES, ensure_demo_users
from app.services.seed_showcase import ensure_showcase_project


async def run() -> int:
    if settings.normalized_environment != "test":
        print("e2e seed refused: ENVIRONMENT must be test", file=sys.stderr)
        return 2
    if not settings.database_url.strip().lower().startswith("sqlite"):
        print("e2e seed refused: DATABASE_URL must be isolated SQLite", file=sys.stderr)
        return 2

    showcase: dict[str, object] = {}
    async with SessionLocal() as db:
        # The canonical seed is idempotent, but its legacy first pass creates the
        # apartment before the house. Run reconciliation once more so a pristine
        # review/E2E database immediately contains the complete demo project set.
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
        # The contractor should be able to review both canonical projects.
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
                "environment": "test",
                "seed": "canonical_demo",
                "scope": "playwright",
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
