"""ROLE-016: серверные правила удаления аккаунта (блокировка, анонимизация, отзыв токенов)."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import app
from app.models.entities import (
    Payment,
    PaymentStatus,
    PaymentType,
    PortalLink,
    Project,
    PushToken,
    User,
    UserRole,
    UserSession,
)
from app.services import session_service


async def _seed(db):
    customer = User(id="cu-del", phone="+79990070001", role=UserRole.customer, full_name="Иван", inn="123456789012")
    contractor = User(id="ct-del", phone="+79990070002", role=UserRole.contractor)
    db.add_all([customer, contractor])
    await db.commit()
    return customer, contractor


def _project(pid, customer, contractor=None, **kw):
    return Project(id=pid, name=pid, renovation_type="cosmetic", customer_id=customer.id,
                   contractor_id=contractor.id if contractor else None, budget_planned=1, budget_spent=0, **kw)


async def _client(db, actor):
    async def _db():
        yield db

    async def _user():
        return actor

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_active_project_with_contractor_blocks_customer(db):
    customer, contractor = await _seed(db)
    db.add(_project("p1", customer, contractor))
    await db.commit()
    client = await _client(db, customer)
    try:
        check = await client.get("/api/v1/auth/me/deletion-check")
        assert check.json() == {"can_delete": False, "blockers": [{"code": "active_projects", "count": 1}]}
        r = await client.delete("/api/v1/auth/me")
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "account_deletion_blocked"
        r2 = await client.post("/api/v1/auth/anonymize")
        assert r2.status_code == 409
    finally:
        app.dependency_overrides.clear()
    await db.refresh(customer)
    assert customer.deleted_at is None and customer.full_name == "Иван"


@pytest.mark.asyncio
async def test_contractor_on_active_project_is_blocked(db):
    customer, contractor = await _seed(db)
    db.add(_project("p2", customer, contractor))
    await db.commit()
    client = await _client(db, contractor)
    try:
        r = await client.delete("/api/v1/auth/me")
        assert r.status_code == 409
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_unsettled_money_blocks_even_when_project_archived(db):
    customer, contractor = await _seed(db)
    db.add(_project("p3", customer, contractor, is_archived=True))
    db.add(Payment(id="pay1", project_id="p3", payment_type=PaymentType.stage, status=PaymentStatus.paid_unverified,
                   title="Этап", amount=1000, created_by=contractor.id))
    await db.commit()
    client = await _client(db, customer)
    try:
        r = await client.get("/api/v1/auth/me/deletion-check")
        assert r.json()["blockers"] == [{"code": "unsettled_payments", "count": 1}]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_delete_allowed_anonymizes_and_revokes_everything(db):
    customer, contractor = await _seed(db)
    # архивный проект с подтверждённой оплатой и проект без исполнителя не мешают
    db.add_all([
        _project("p4", customer, contractor, is_archived=True),
        _project("p5", customer),
        Payment(id="pay2", project_id="p4", payment_type=PaymentType.stage, status=PaymentStatus.confirmed,
                title="Этап", amount=1000, created_by=contractor.id),
        PushToken(user_id=customer.id, token="ExponentPushToken[x]"),
    ])
    await db.commit()
    await session_service.create_session(db, customer.id)
    from app.services import portal_link_service as links
    link, _tok = await links.issue_link(db, project_id="p5", user_id=customer.id, issued_by=customer.id, scopes=["read"])
    client = await _client(db, customer)
    try:
        assert (await client.get("/api/v1/auth/me/deletion-check")).json() == {"can_delete": True, "blockers": []}
        r = await client.delete("/api/v1/auth/me")
        assert r.status_code == 200 and r.json()["soft_deleted"] is True
    finally:
        app.dependency_overrides.clear()
    await db.refresh(customer)
    assert customer.deleted_at is not None
    assert customer.phone.startswith("deleted-") and customer.full_name == "Deleted" and customer.inn is None
    from sqlalchemy import select
    assert (await db.execute(select(UserSession).where(UserSession.user_id == customer.id, UserSession.revoked_at.is_(None)))).first() is None
    assert (await db.execute(select(PushToken).where(PushToken.user_id == customer.id))).first() is None
    await db.refresh(link)
    assert link.revoked_at is not None


@pytest.mark.asyncio
async def test_purge_keeps_user_still_referenced_by_project(db):
    from datetime import timedelta
    from app.core.timeutil import utc_now
    from app.services.account_purge_service import purge_deleted_users

    customer, _ = await _seed(db)
    db.add(_project("p6", customer))
    customer.deleted_at = utc_now() - timedelta(days=60)
    await db.commit()
    assert await purge_deleted_users(db) == 0
    assert await db.get(User, customer.id) is not None
