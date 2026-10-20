"""PostgreSQL: one exact digest can produce one customer decision and cap only."""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal
import os
import uuid

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - migrated complete metadata
from app.models.client_scope_consent import (
    ClientFinancialAuthorization, ClientScopeDecision, ClientScopeVersion,
)
from app.models.entities import DomainOutbox, Project, Room, User, UserRole, WorkOrder, WorkOrderStatus
from app.services import client_scope_consent_service as consent


@pytest.mark.asyncio
async def test_double_customer_click_one_scope_one_authorization_postgresql():
    url = os.environ.get("PROJECT_REFUND_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("dedicated migrated PostgreSQL CI database required")
    engine = create_async_engine(url, pool_size=6, max_overflow=0)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    tag = uuid.uuid4().hex[:10]
    customer_id = f"scope-pg-c-{tag}"
    contractor_id = f"scope-pg-e-{tag}"
    project_id = f"scope-pg-project-{tag}"
    room_id = f"scope-pg-room-{tag}"
    work_id = f"scope-pg-work-{tag}"
    scope_id = None
    try:
        async with Session() as db:
            customer = User(
                id=customer_id, phone=f"+7997{int(tag,16) % 10**9:09d}",
                role=UserRole.customer, full_name="Клиент PostgreSQL",
            )
            contractor = User(
                id=contractor_id, phone=f"+7998{int(tag,16) % 10**9:09d}",
                role=UserRole.contractor, full_name="Мастер PostgreSQL",
            )
            db.add_all([customer, contractor])
            await db.flush()
            project = Project(
                id=project_id, name="Customer consent race",
                renovation_type="cosmetic", customer_id=customer_id,
                contractor_id=contractor_id,
            )
            db.add(project)
            await db.flush()
            db.add(Room(
                id=room_id, project_id=project_id,
                name="Контрольная комната", room_type="living",
                length_m=4, width_m=4, height_m=2.7,
                openings_sq_m=0, outlets_count=0, switches_count=0,
                plumbing_points=0,
            ))
            await db.flush()
            work = WorkOrder(
                id=work_id, project_id=project_id, room_id=room_id,
                title="Объём перед допуском", work_type="painting",
                status=WorkOrderStatus.published, budget_planned=4000.0,
                assignee_id=contractor_id, created_by=contractor_id,
                planned_start=date(2026, 11, 1),
                planned_end=date(2026, 11, 2),
            )
            db.add(work)
            await db.commit()
            await db.refresh(work)
            snapshot = await consent.propose_scope(
                db, project=project, work_order_id=work.id,
                actor=contractor, expected_updated_at=work.updated_at,
                client_request_id=f"scope-postgres-race-{tag}",
                specialist_id=contractor_id, quantity="2.000",
                unit="м²", unit_price="2000.00", amount_cap="4000.00",
                inclusions=["Покраска"], exclusions=["Вывоз мусора"],
                deliverables=["Готовая стена"], payment_milestone="После приёмки",
                risks=[],
            )
            scope_id = snapshot["id"]
            digest = snapshot["digest"]

        barrier = asyncio.Event()
        release = asyncio.Event()

        async def hold_project():
            async with Session() as db:
                locked = await db.scalar(
                    select(Project).where(Project.id == project_id).with_for_update()
                )
                assert locked is not None
                barrier.set()
                await asyncio.wait_for(release.wait(), 20)
                await db.commit()

        async def approve_once():
            async with Session() as db:
                project = await db.get(Project, project_id)
                customer = await db.get(User, customer_id)
                return await consent.decide_scope(
                    db, project=project, scope_version_id=scope_id,
                    actor=customer, digest=digest, decision="approved",
                )

        hold = asyncio.create_task(hold_project())
        try:
            await asyncio.wait_for(barrier.wait(), 20)
            a = asyncio.create_task(approve_once())
            b = asyncio.create_task(approve_once())
            await asyncio.sleep(0.2)
        finally:
            release.set()
            await asyncio.wait_for(hold, 20)
        results = await asyncio.wait_for(asyncio.gather(a, b), 40)
        assert sorted(r["replayed"] for r in results) == [False, True]
        assert results[0]["authorization_id"] == results[1]["authorization_id"]

        async with Session() as db:
            assert await db.scalar(
                select(func.count()).select_from(ClientScopeDecision).where(
                    ClientScopeDecision.scope_version_id == scope_id
                )
            ) == 1
            assert await db.scalar(
                select(func.count()).select_from(ClientFinancialAuthorization).where(
                    ClientFinancialAuthorization.scope_version_id == scope_id
                )
            ) == 1
            grant = await db.scalar(
                select(ClientFinancialAuthorization).where(
                    ClientFinancialAuthorization.scope_version_id == scope_id
                )
            )
            assert grant.customer_id == customer_id
            assert grant.amount_cap == Decimal("4000.00")
            assert grant.committed_amount == Decimal("0.00")
            assert grant.consumed_amount == Decimal("0.00")
    finally:
        async with Session() as db:
            if scope_id:
                await db.execute(delete(DomainOutbox).where(
                    DomainOutbox.aggregate_id == scope_id
                ))
                await db.execute(delete(ClientFinancialAuthorization).where(
                    ClientFinancialAuthorization.scope_version_id == scope_id
                ))
                await db.execute(delete(ClientScopeDecision).where(
                    ClientScopeDecision.scope_version_id == scope_id
                ))
                await db.execute(delete(ClientScopeVersion).where(
                    ClientScopeVersion.id == scope_id
                ))
            await db.execute(delete(WorkOrder).where(WorkOrder.id == work_id))
            await db.execute(delete(Room).where(Room.id == room_id))
            await db.execute(delete(Project).where(Project.id == project_id))
            await db.execute(delete(User).where(User.id.in_((customer_id, contractor_id))))
            await db.commit()
        await engine.dispose()
