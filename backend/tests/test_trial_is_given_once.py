"""Пробный период даётся один раз — и после покупки Pro тоже.

H1.1: «один trial 14 дней на исполнителя». Факт использования хранился в
изменяемой строке `subscriptions.plan`:

    if s.plan == "trial_used":
        return None, {"code": "trial_used", ...}

Но в ту же колонку пишут все остальные переходы. `activate_pro` ставит "pro",
а истечение Pro — `_expire_if_needed` — ставит "free". Признак исчезал вместе
с ними, и цикл

    триал 14 дней → Pro 30 дней → Pro истёк → снова триал 14 дней → …

повторялся сколько угодно раз. В dev-режиме, где checkout активирует Pro без
оплаты, он не стоил вообще ничего.

Факт из прошлого теперь живёт в `trial_started_at`, куда не пишет ни покупка,
ни истечение.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.timeutil import utc_now
from app.db.base import Base
from app.models.client_write_request import ClientWriteRequest  # noqa: F401
from app.models.entities import Subscription, SubscriptionStatus, User, UserRole
from app.services import subscription_service as subs


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def _contractor(db, suffix: str) -> str:
    user = User(id=f"tr-{suffix}", phone=f"+7955{suffix:0>7}", role=UserRole.contractor)
    db.add(user)
    await db.commit()
    return user.id


async def _expire_now(db, user_id: str) -> None:
    """Перематываем подписку за её конец, как это делает время."""
    s = await subs.get_sub(db, user_id)
    s.expires_at = utc_now() - timedelta(seconds=1)
    await db.commit()
    await subs._expire_if_needed(db, s)


@pytest.mark.asyncio
async def test_the_trial_cannot_be_taken_twice(db):
    user_id = await _contractor(db, "twice")

    first, result = await subs.start_trial(db, user_id)
    assert result["code"] == "trial_started"
    assert first is not None

    await _expire_now(db, user_id)

    second, refused = await subs.start_trial(db, user_id)
    assert second is None, "второй пробный период выдан"
    assert refused["code"] == "trial_used"


@pytest.mark.asyncio
async def test_buying_pro_does_not_restore_the_trial(db):
    """Тот самый цикл: триал → Pro → истечение Pro → снова триал."""
    user_id = await _contractor(db, "cycle")

    await subs.start_trial(db, user_id)
    await _expire_now(db, user_id)

    await subs.activate_pro(db, user_id, days=30)
    await _expire_now(db, user_id)

    # Здесь plan снова "free" — ровно как у исполнителя, впервые открывшего
    # приложение. Отличает их только память о триале.
    s = await subs.get_sub(db, user_id)
    assert s.plan == "free"

    again, refused = await subs.start_trial(db, user_id)
    assert again is None, "оплаченный месяц вернул бесплатные 14 дней"
    assert refused["code"] == "trial_used"

    payload = await subs.subscription_payload(db, user_id)
    assert payload["trial_available"] is False, (
        "экран подписки всё ещё предлагает пробный период"
    )


@pytest.mark.asyncio
async def test_a_contractor_who_never_tried_still_gets_the_trial(db):
    """Страховка от «отказывать всем»: без этого предыдущие тесты проходили бы
    и при полностью выключённом триале."""
    user_id = await _contractor(db, "first")

    payload = await subs.subscription_payload(db, user_id)
    assert payload["trial_available"] is True

    sub, result = await subs.start_trial(db, user_id)
    assert result["code"] == "trial_started"
    assert sub.status == SubscriptionStatus.active
    assert sub.plan == "trial"
    assert sub.trial_started_at is not None


@pytest.mark.asyncio
async def test_a_contractor_who_only_ever_bought_pro_keeps_the_trial(db):
    """Покупка — не использование триала. Купивший сразу Pro право не теряет."""
    user_id = await _contractor(db, "bought")

    await subs.activate_pro(db, user_id, days=30)
    await _expire_now(db, user_id)

    sub, result = await subs.start_trial(db, user_id)
    assert result["code"] == "trial_started", "триал отобран у того, кто его не брал"
    assert sub is not None


@pytest.mark.asyncio
async def test_an_old_subscription_without_the_column_is_still_remembered(db):
    """Подписки, созданные до появления колонки: plan == "trial_used", а
    trial_started_at пуст, если бэкфилл миграции где-то не отработал."""
    user_id = await _contractor(db, "legacy")
    db.add(
        Subscription(
            user_id=user_id,
            status=SubscriptionStatus.free,
            plan="trial_used",
            trial_started_at=None,
        )
    )
    await db.commit()

    again, refused = await subs.start_trial(db, user_id)
    assert again is None
    assert refused["code"] == "trial_used"
