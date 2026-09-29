"""Issue #413: queued design-package creation must be replay-safe.

The mobile offline queue (apps/mobile/lib/offlineQueue.ts) can replay a lost/ambiguous
POST /projects/{project_id}/design-packages with the same `client_request_id`.
Before this fix, app.services.design_package_service.create_package had no consumer
for that identity, so a retried request could mint a second DesignPackage/version.

These tests exercise the service layer directly (same pattern as
tests/test_stage_comment_idempotency_398.py) and assert that two calls with the
same request_id + same canonical {title, file_key, notes} payload produce exactly
one DesignPackage, while the same request_id with a different payload is rejected
as a 409 idempotency conflict, and different request_ids with identical values
remain distinct design versions.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.db.base import Base
from app.models.entities import DesignPackage, Project, User, UserRole
from app.services import design_package_service as design_svc
from app.services.client_write_idempotency import IdempotencyConflict


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(db):
    customer = User(
        id="c1111111-1111-1111-1111-111111111111",
        phone="+79990000301",
        role=UserRole.customer,
        full_name="Customer",
    )
    contractor = User(
        id="c2222222-2222-2222-2222-222222222222",
        phone="+79990000302",
        role=UserRole.contractor,
        full_name="Contractor",
    )
    project = Project(
        id="c3333333-3333-3333-3333-333333333333",
        name="Design package idempotency",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    db.add_all([customer, contractor, project])
    await db.commit()
    return customer, contractor, project


@pytest.fixture
async def session_env():
    engine, Session = await _session_factory()
    try:
        yield engine, Session
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_same_request_id_and_payload_replays_one_package(session_env):
    """Two identical queued POST .../design-packages with the same
    client_request_id must not mint two DesignPackages — the second call
    replays the first result."""
    _engine, Session = session_env
    async with Session() as db:
        _customer, contractor, project = await _seed(db)

        kwargs = dict(
            project=project,
            actor=contractor,
            title="Кухня v1",
            file_key="designs/kitchen-v1.pdf",
            notes="Первая версия",
            client_request_id="offline-design-package-0001",
        )
        first = await design_svc.create_package(db, **kwargs)
        second = await design_svc.create_package(db, **kwargs)

        assert second.id == first.id
        packages = (
            await db.execute(select(DesignPackage).where(DesignPackage.project_id == project.id))
        ).scalars().all()
        assert len(packages) == 1
        assert packages[0].version == 1


@pytest.mark.asyncio
async def test_same_request_id_different_payload_conflicts(session_env):
    """Same client_request_id with a changed canonical payload (title/file_key/notes)
    must raise IdempotencyConflict, never silently mint or overwrite a version."""
    _engine, Session = session_env
    async with Session() as db:
        _customer, contractor, project = await _seed(db)
        contractor_id, project_id = contractor.id, project.id

        await design_svc.create_package(
            db,
            project=project,
            actor=contractor,
            title="Кухня v1",
            file_key="designs/kitchen-v1.pdf",
            notes="Первая версия",
            client_request_id="offline-design-package-0002",
        )
        with pytest.raises(IdempotencyConflict):
            await design_svc.create_package(
                db,
                project=project,
                actor=contractor,
                title="Совсем другой пакет",
                file_key="designs/kitchen-v1.pdf",
                notes="Первая версия",
                client_request_id="offline-design-package-0002",
            )

        packages = (
            await db.execute(select(DesignPackage).where(DesignPackage.project_id == project_id))
        ).scalars().all()
        assert len(packages) == 1
        assert contractor_id  # keep reference alive across rollback


@pytest.mark.asyncio
async def test_different_request_ids_identical_values_remain_distinct_versions(session_env):
    """Two independent create calls with identical title/file_key/notes but
    different client_request_id values must remain two deliberate design
    versions, not collapse into one."""
    _engine, Session = session_env
    async with Session() as db:
        _customer, contractor, project = await _seed(db)

        first = await design_svc.create_package(
            db,
            project=project,
            actor=contractor,
            title="Кухня",
            file_key="designs/kitchen.pdf",
            notes=None,
            client_request_id="offline-design-package-0003",
        )
        second = await design_svc.create_package(
            db,
            project=project,
            actor=contractor,
            title="Кухня",
            file_key="designs/kitchen.pdf",
            notes=None,
            client_request_id="offline-design-package-0004",
        )

        assert first.id != second.id
        assert first.version == 1
        assert second.version == 2
        packages = (
            await db.execute(select(DesignPackage).where(DesignPackage.project_id == project.id))
        ).scalars().all()
        assert len(packages) == 2
