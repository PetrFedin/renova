from __future__ import annotations

from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import Project, ProjectViewer, User, UserRole
from app.services import project_viewer_service as viewer_svc


@pytest_asyncio.fixture
async def viewer_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed(viewer_db):
    owner = User(id="viewer-owner", phone="+79990000901", role=UserRole.customer)
    guest = User(id="viewer-guest", phone="+79990000902", role=UserRole.customer)
    project = Project(
        id="viewer-project",
        name="Viewer access",
        renovation_type="cosmetic",
        customer_id=owner.id,
    )
    viewer_db.add_all([owner, guest, project])
    await viewer_db.commit()
    return owner, guest, project


@pytest.mark.asyncio
async def test_grant_project_viewer_is_idempotent(viewer_db):
    _, guest, project = await _seed(viewer_db)

    first, first_created = await viewer_svc.grant_project_viewer(
        viewer_db,
        project_id=project.id,
        user_id=guest.id,
    )
    second, second_created = await viewer_svc.grant_project_viewer(
        viewer_db,
        project_id=project.id,
        user_id=guest.id,
    )

    assert first_created is True
    assert second_created is False
    assert second.id == first.id
    assert (
        await viewer_db.scalar(select(func.count()).select_from(ProjectViewer))
    ) == 1


@pytest.mark.asyncio
async def test_unique_race_rereads_winner_without_poisoning_session():
    winner = SimpleNamespace(id="winner", project_id="project", user_id="guest")

    class Nested:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

    class RacingDB:
        def __init__(self):
            self.scalar_results = [None, winner]
            self.added = []
            self.committed = False

        async def scalar(self, _statement):
            return self.scalar_results.pop(0)

        def begin_nested(self):
            return Nested()

        def add(self, value):
            self.added.append(value)

        async def flush(self):
            raise IntegrityError("insert project_viewers", {}, Exception("duplicate"))

        async def commit(self):
            self.committed = True

    db = RacingDB()
    stored, created = await viewer_svc.grant_project_viewer(
        db,
        project_id="project",
        user_id="guest",
    )

    assert stored is winner
    assert created is False
    assert db.committed is False
    assert len(db.added) == 1


def test_intrinsic_access_is_not_duplicated_as_guest():
    project = SimpleNamespace(
        customer_id="owner",
        contractor_id="contractor",
        foreman_id="foreman",
    )

    assert viewer_svc.has_intrinsic_project_access(project, "owner") is True
    assert viewer_svc.has_intrinsic_project_access(project, "contractor") is True
    assert viewer_svc.has_intrinsic_project_access(project, "foreman") is True
    assert viewer_svc.has_intrinsic_project_access(project, "guest") is False


def test_viewer_endpoint_uses_atomic_service_and_no_demo_copy():
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "api" / "v1" / "projects.py").read_text(
        encoding="utf-8"
    )
    start = source.index('@router.post("/{project_id}/viewers")')
    end = source.index('@router.get("/{project_id}/contract-gate")', start)
    block = source[start:end]

    assert "grant_project_viewer" in block
    assert "db.add(ProjectViewer" not in block
    assert "await db.commit()" not in block
    assert "demo" not in block.lower()
    assert "await svc.get_project" not in source[
        source.index('@router.get("/{project_id}/viewers")') : start
    ]
