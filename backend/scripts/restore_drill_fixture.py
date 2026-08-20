"""Create and verify a deterministic synthetic fixture for PostgreSQL restore drills.

This script is intentionally limited to synthetic CI/DR data. It never exports or
prints production user data. The manifest contains only fixed fixture values,
row counts for fixture tables, the Alembic revision and a SHA-256 fingerprint.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.entities import AuditLog, Project, Room, Stage, StageStatus, User, UserRole


CUSTOMER_ID = "00000000-0000-0000-0000-000000000101"
CONTRACTOR_ID = "00000000-0000-0000-0000-000000000102"
PROJECT_ID = "00000000-0000-0000-0000-000000000201"
ROOM_ID = "00000000-0000-0000-0000-000000000301"
STAGE_ID = "00000000-0000-0000-0000-000000000401"
AUDIT_ID = "00000000-0000-0000-0000-000000000501"


def _database_url() -> str:
    value = os.environ.get("DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL is required")
    if not value.startswith("postgresql+asyncpg://"):
        raise RuntimeError("restore drill requires PostgreSQL/asyncpg DATABASE_URL")
    return value


def _fingerprint(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _seed(session: AsyncSession) -> None:
    if await session.get(User, CUSTOMER_ID) is not None:
        raise RuntimeError("restore drill fixture already exists; source database must be fresh")

    customer = User(
        id=CUSTOMER_ID,
        phone="+70000000101",
        role=UserRole.customer,
        full_name="DR Fixture Customer",
    )
    contractor = User(
        id=CONTRACTOR_ID,
        phone="+70000000102",
        role=UserRole.contractor,
        full_name="DR Fixture Contractor",
    )
    session.add_all([customer, contractor])
    await session.flush()

    project = Project(
        id=PROJECT_ID,
        name="DR Restore Fixture",
        address="Synthetic restore drill address",
        renovation_type="cosmetic",
        property_type="apartment",
        total_area_sqm=42.5,
        customer_id=CUSTOMER_ID,
        contractor_id=CONTRACTOR_ID,
        budget_planned=250000,
        budget_spent=12500,
        progress_percent=25,
        vat_rate=20,
    )
    session.add(project)
    await session.flush()

    room = Room(
        id=ROOM_ID,
        project_id=PROJECT_ID,
        name="DR Fixture Room",
        room_type="living",
        floor_level=1,
        length_m=5.0,
        width_m=4.0,
        height_m=2.8,
        openings_sq_m=2.5,
        outlets_count=4,
        switches_count=2,
        plumbing_points=0,
    )
    stage = Stage(
        id=STAGE_ID,
        project_id=PROJECT_ID,
        name="DR Fixture Stage",
        sort_order=1,
        status=StageStatus.active,
        percent_complete=25,
        payment_amount=50000,
        weight_coefficient=1,
        assignee_id=CONTRACTOR_ID,
    )
    audit = AuditLog(
        id=AUDIT_ID,
        user_id=CUSTOMER_ID,
        method="POST",
        path="/dr/fixture",
        status_code=201,
    )
    session.add_all([room, stage, audit])
    await session.commit()


async def _snapshot(session: AsyncSession) -> dict[str, Any]:
    revision = str(await session.scalar(text("SELECT version_num FROM alembic_version")))

    users = list(
        (
            await session.execute(
                select(User.id, User.phone, User.role, User.full_name)
                .where(User.id.in_([CUSTOMER_ID, CONTRACTOR_ID]))
                .order_by(User.id)
            )
        ).all()
    )
    project = (
        await session.execute(
            select(
                Project.id,
                Project.name,
                Project.renovation_type,
                Project.property_type,
                Project.total_area_sqm,
                Project.customer_id,
                Project.contractor_id,
                Project.budget_planned,
                Project.budget_spent,
                Project.progress_percent,
                Project.vat_rate,
            ).where(Project.id == PROJECT_ID)
        )
    ).one_or_none()
    room = (
        await session.execute(
            select(
                Room.id,
                Room.project_id,
                Room.name,
                Room.room_type,
                Room.length_m,
                Room.width_m,
                Room.height_m,
                Room.outlets_count,
                Room.switches_count,
            ).where(Room.id == ROOM_ID)
        )
    ).one_or_none()
    stage = (
        await session.execute(
            select(
                Stage.id,
                Stage.project_id,
                Stage.name,
                Stage.status,
                Stage.percent_complete,
                Stage.payment_amount,
                Stage.assignee_id,
            ).where(Stage.id == STAGE_ID)
        )
    ).one_or_none()
    audit = (
        await session.execute(
            select(
                AuditLog.id,
                AuditLog.user_id,
                AuditLog.method,
                AuditLog.path,
                AuditLog.status_code,
            ).where(AuditLog.id == AUDIT_ID)
        )
    ).one_or_none()

    if len(users) != 2 or project is None or room is None or stage is None or audit is None:
        raise RuntimeError("restore drill fixture is incomplete")

    counts = {}
    for label, model in (
        ("users", User),
        ("projects", Project),
        ("rooms", Room),
        ("stages", Stage),
        ("audit_logs", AuditLog),
    ):
        counts[label] = int(await session.scalar(select(func.count()).select_from(model)) or 0)

    payload: dict[str, Any] = {
        "alembic_revision": revision,
        "counts": counts,
        "users": [
            {
                "id": row.id,
                "phone": row.phone,
                "role": row.role.value if isinstance(row.role, UserRole) else str(row.role),
                "full_name": row.full_name,
            }
            for row in users
        ],
        "project": {
            "id": project.id,
            "name": project.name,
            "renovation_type": project.renovation_type,
            "property_type": project.property_type,
            "total_area_sqm": project.total_area_sqm,
            "customer_id": project.customer_id,
            "contractor_id": project.contractor_id,
            "budget_planned": project.budget_planned,
            "budget_spent": project.budget_spent,
            "progress_percent": project.progress_percent,
            "vat_rate": project.vat_rate,
        },
        "room": {
            "id": room.id,
            "project_id": room.project_id,
            "name": room.name,
            "room_type": room.room_type,
            "length_m": room.length_m,
            "width_m": room.width_m,
            "height_m": room.height_m,
            "outlets_count": room.outlets_count,
            "switches_count": room.switches_count,
        },
        "stage": {
            "id": stage.id,
            "project_id": stage.project_id,
            "name": stage.name,
            "status": stage.status.value if isinstance(stage.status, StageStatus) else str(stage.status),
            "percent_complete": stage.percent_complete,
            "payment_amount": stage.payment_amount,
            "assignee_id": stage.assignee_id,
        },
        "audit": {
            "id": audit.id,
            "user_id": audit.user_id,
            "method": audit.method,
            "path": audit.path,
            "status_code": audit.status_code,
        },
    }
    return {
        "snapshot": payload,
        "fingerprint_sha256": _fingerprint(payload),
    }


async def _run(command: str, manifest: Path | None, expected: Path | None) -> None:
    engine = create_async_engine(_database_url())
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            if command == "seed":
                await _seed(session)
            result = await _snapshot(session)
    finally:
        await engine.dispose()

    if command == "verify":
        if expected is None:
            raise RuntimeError("--expected is required for verify")
        baseline = json.loads(expected.read_text(encoding="utf-8"))
        if result != baseline:
            raise RuntimeError(
                "restored fixture does not match source manifest: "
                f"expected={baseline.get('fingerprint_sha256')} "
                f"actual={result.get('fingerprint_sha256')}"
            )

    if manifest is not None:
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "command": command,
                "alembic_revision": result["snapshot"]["alembic_revision"],
                "fingerprint_sha256": result["fingerprint_sha256"],
            },
            sort_keys=True,
        )
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("seed", "verify", "inspect"))
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--expected", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    asyncio.run(_run(args.command, args.manifest, args.expected))
