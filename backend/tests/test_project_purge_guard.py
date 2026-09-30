"""Purge/empty_trash must not destroy financial history or signed documents;
trash/restore preserves archive state; purge removes stored files."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.entities import Payment, PaymentStatus, PaymentType, Project, User, UserRole, WorkAcceptance, Stage
from app.models.project_documents import DocumentSignature, DocumentVersion, ProjectDocument
from app.services import project_service


async def _owner(db):
    owner = User(id="cu-pg", phone="+79990007001", role=UserRole.customer)
    db.add(owner)
    await db.commit()
    return owner


async def _project(db, owner, pid, *, trashed=True, archived=False):
    from app.core.timeutil import utc_now

    p = Project(
        id=pid, name=f"P {pid}", renovation_type="cosmetic", customer_id=owner.id,
        budget_planned=1, budget_spent=0, is_archived=archived,
        trashed_at=utc_now() if trashed else None,
    )
    db.add(p)
    await db.commit()
    return p


async def _client(db, actor):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _add_payment(db, pid, status, owner):
    db.add(Payment(
        id=f"pay-{pid}", project_id=pid, payment_type=PaymentType.stage, title="Advance",
        amount=1000, status=status, created_by=owner.id,
    ))
    await db.commit()


async def _count(db, model):
    return await db.scalar(select(func.count()).select_from(model))


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [PaymentStatus.confirmed, PaymentStatus.paid_unverified])
async def test_purge_with_financial_payment_is_409_and_payment_kept(db, status):
    owner = await _owner(db)
    await _project(db, owner, "p-pay")
    await _add_payment(db, "p-pay", status, owner)
    client = await _client(db, owner)
    try:
        async with client as c:
            r = await c.delete("/api/v1/projects/p-pay")
        assert r.status_code == 409
        d = r.json()["detail"]
        assert d["code"] == "financial_history_blocks_purge"
        assert "платеж" in d["message"].lower()
        assert d["reasons"][0]["code"] == "payments"
    finally:
        app.dependency_overrides.clear()
    assert await _count(db, Payment) == 1
    assert (await db.get(Project, "p-pay")).trashed_at is not None


@pytest.mark.asyncio
async def test_purge_with_signed_document_is_409(db):
    owner = await _owner(db)
    await _project(db, owner, "p-doc")
    db.add(ProjectDocument(id="d1", project_id="p-doc", title="Договор", document_type="contract"))
    await db.flush()
    db.add(DocumentVersion(id="v1", document_id="d1", version_number=1))
    await db.flush()
    db.add(DocumentSignature(id="s1", document_id="d1", version_id="v1", signer_user_id=owner.id, status="signed"))
    await db.commit()
    with pytest.raises(project_service.PurgeBlocked) as ei:
        await project_service.purge_project(db, "p-doc", owner)
    assert ei.value.reasons[0]["code"] == "signed_documents"
    assert await db.get(Project, "p-doc") is not None
    assert await _count(db, DocumentSignature) == 1


@pytest.mark.asyncio
async def test_purge_with_accepted_act_is_blocked(db):
    owner = await _owner(db)
    await _project(db, owner, "p-act")
    db.add(Stage(id="st1", project_id="p-act", name="S", sort_order=0))
    await db.flush()
    db.add(WorkAcceptance(id="wa1", project_id="p-act", stage_id="st1", status="accepted"))
    await db.commit()
    with pytest.raises(project_service.PurgeBlocked) as ei:
        await project_service.purge_project(db, "p-act", owner)
    assert ei.value.reasons[0]["code"] == "accepted_acts"


@pytest.mark.asyncio
async def test_purge_empty_project_deletes_row_and_files(db, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))
    monkeypatch.setattr(settings, "s3_endpoint", None)
    monkeypatch.setattr(settings, "s3_access_key", None)
    monkeypatch.setattr(settings, "s3_secret_key", None)
    owner = await _owner(db)
    await _project(db, owner, "p-empty")
    await _project(db, owner, "p-other")
    for pid in ("p-empty", "p-other"):
        f = tmp_path / "project-media" / pid / "a.jpg"
        f.parent.mkdir(parents=True)
        f.write_bytes(b"x")
    client = await _client(db, owner)
    try:
        async with client as c:
            r = await c.delete("/api/v1/projects/p-empty")
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()
    assert await db.get(Project, "p-empty") is None
    assert not (tmp_path / "project-media" / "p-empty").exists()
    assert (tmp_path / "project-media" / "p-other" / "a.jpg").exists()


@pytest.mark.asyncio
async def test_storage_cleanup_failure_does_not_undo_purge(db, monkeypatch):
    from app.services import storage_service

    async def boom(prefix):
        raise RuntimeError("s3 down")

    monkeypatch.setattr(storage_service, "delete_prefix", boom)
    owner = await _owner(db)
    await _project(db, owner, "p-boom")
    await project_service.purge_project(db, "p-boom", owner)
    assert await db.get(Project, "p-boom") is None


@pytest.mark.asyncio
async def test_empty_trash_skips_blocked_and_reports_reason(db):
    owner = await _owner(db)
    await _project(db, owner, "p-keep")
    await _project(db, owner, "p-go")
    await _add_payment(db, "p-keep", PaymentStatus.confirmed, owner)
    client = await _client(db, owner)
    try:
        async with client as c:
            r = await c.delete("/api/v1/projects/trash/empty")
        assert r.status_code == 200
        body = r.json()
        assert body["deleted"] == 1
        assert [s["project_id"] for s in body["skipped"]] == ["p-keep"]
        assert body["skipped"][0]["code"] == "financial_history_blocks_purge"
        assert body["skipped"][0]["reasons"][0]["code"] == "payments"
    finally:
        app.dependency_overrides.clear()
    assert await db.get(Project, "p-go") is None
    assert await db.get(Project, "p-keep") is not None
    assert await _count(db, Payment) == 1


@pytest.mark.asyncio
async def test_trash_restore_keeps_archived_state(db):
    owner = await _owner(db)
    await _project(db, owner, "p-arch", trashed=False, archived=True)
    p = await project_service.trash_project(db, "p-arch", owner)
    assert p.trashed_at is not None and p.is_archived is True
    p = await project_service.restore_project(db, "p-arch", owner)
    assert p.trashed_at is None and p.is_archived is True
