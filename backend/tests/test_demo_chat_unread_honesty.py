"""Investor QA: demo seed не оставляет epoch-unread spam (badge 10–20)."""
import pytest
from sqlalchemy import select

from app.db.session import init_db
from app.models.entities import User, Project
from app.services import chat_service as chat_svc
from app.services.seed_demo import DEMO_PHONES, ensure_demo_users

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "chat_honesty.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    from app.core import config
    from app.db import session as sess
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    config.settings.database_url = f"sqlite+aiosqlite:///{db_path}"
    sess.engine = create_async_engine(config.settings.database_url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)


async def test_demo_seed_unread_is_honest():
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        customer = (
            await db.execute(select(User).where(User.phone == DEMO_PHONES["customer"]))
        ).scalar_one()
        contractor = (
            await db.execute(select(User).where(User.phone == DEMO_PHONES["contractor"]))
        ).scalar_one()
        projects = list(
            (await db.execute(select(Project).where(Project.customer_id == customer.id))).scalars()
        )
        assert projects, "demo projects expected"

        total_c = total_k = 0
        thread_count = 0
        for p in projects:
            threads = await chat_svc.list_threads(db, p.id)
            thread_count += len(threads)
            for t in threads:
                total_c += await chat_svc.count_unread_in_thread(db, t.id, customer.id)
                total_k += await chat_svc.count_unread_in_thread(db, t.id, contractor.id)

        assert thread_count >= 1, "demo chats expected"
        # Честный demo: после seed ≤2 unread на роль (цель — 0; запас на future ping)
        assert total_c <= 2, f"customer unread too high: {total_c}"
        assert total_k <= 2, f"contractor unread too high: {total_k}"


async def test_demo_reseed_keeps_honest_unread():
    """Early-return path (_non_system_count) тоже должен mark-read."""
    from app.db import session as sess

    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)  # second pass / early return
        customer = (
            await db.execute(select(User).where(User.phone == DEMO_PHONES["customer"]))
        ).scalar_one()
        projects = list(
            (await db.execute(select(Project).where(Project.customer_id == customer.id))).scalars()
        )
        total = 0
        for p in projects:
            for t in await chat_svc.list_threads(db, p.id):
                total += await chat_svc.count_unread_in_thread(db, t.id, customer.id)
        assert total <= 2, f"reseed customer unread={total}"
