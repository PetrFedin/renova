"""Real PostgreSQL proof for mixed own/purchased material supply truth."""
from __future__ import annotations

import os
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - register mapped MaterialPick extensions
from app.models.entities import (
    Expense,
    MaterialPick,
    MaterialPickStatus,
    Payment,
    Project,
    Purchase,
    PurchaseItem,
    User,
    UserRole,
)
from app.services import material_supply_service
from app.services.purchase_create_service import prepare_purchase_from_picks


def _postgres_url() -> str:
    value = os.environ.get("MATERIAL_SUPPLY_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("MATERIAL_SUPPLY_POSTGRES_URL is only set by dedicated PostgreSQL workflow")
    return value


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


async def _seed_project(Session):
    customer_id = _id("mat-customer")
    contractor_id = _id("mat-contractor")
    project_id = _id("mat-project")
    async with Session() as db:
        db.add_all(
            [
                User(
                    id=customer_id,
                    phone=f"+79{uuid4().int % 10_000_000_000:010d}",
                    role=UserRole.customer,
                    full_name="Material customer",
                ),
                User(
                    id=contractor_id,
                    phone=f"+78{uuid4().int % 10_000_000_000:010d}",
                    role=UserRole.contractor,
                    full_name="Material contractor",
                ),
            ]
        )
        await db.flush()
        db.add(
            Project(
                id=project_id,
                name="Mixed material supply",
                renovation_type="cosmetic",
                customer_id=customer_id,
                contractor_id=contractor_id,
            )
        )
        await db.commit()
    return customer_id, contractor_id, project_id


def _pick(
    *,
    project_id: str,
    name: str,
    source: str,
    required: float,
    available: float,
) -> MaterialPick:
    return MaterialPick(
        id=_id("mat-pick"),
        project_id=project_id,
        name=name,
        qty=required,
        qty_needed=required,
        qty_delivered=0,
        unit="шт",
        price=100,
        status=MaterialPickStatus.approved,
        supply_source=source,
        qty_available=available,
    )


@pytest.mark.asyncio
async def test_postgres_enforces_material_supply_constraints():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    _, _, project_id = await _seed_project(Session)
    try:
        async with Session() as db:
            db.add(
                _pick(
                    project_id=project_id,
                    name="Invalid source",
                    source="invented_source",
                    required=1,
                    available=0,
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()

            db.add(
                _pick(
                    project_id=project_id,
                    name="Negative available",
                    source="customer_to_buy",
                    required=1,
                    available=-1,
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_postgres_mixed_supply_creates_only_real_remaining_purchase():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id, contractor_id, project_id = await _seed_project(Session)
    try:
        async with Session() as db:
            own = _pick(
                project_id=project_id,
                name="Плитка заказчика",
                source="customer_on_hand",
                required=5,
                available=5,
            )
            buy = _pick(
                project_id=project_id,
                name="Краска к покупке",
                source="customer_to_buy",
                required=10,
                available=3,
            )
            db.add_all([own, buy])
            await db.commit()

            customer = await db.get(User, customer_id)
            contractor = await db.get(User, contractor_id)
            assert customer is not None and contractor is not None

            with pytest.raises(ValueError, match="purchase_pick_not_buy_required"):
                await prepare_purchase_from_picks(
                    db,
                    project_id=project_id,
                    actor=customer,
                    pick_ids=[own.id],
                    supplier_name="Не должен появиться",
                )

            with pytest.raises(ValueError, match="purchase_pick_responsibility_forbidden"):
                await prepare_purchase_from_picks(
                    db,
                    project_id=project_id,
                    actor=contractor,
                    pick_ids=[buy.id],
                    supplier_name="Чужая ответственность",
                )

            purchase = await prepare_purchase_from_picks(
                db,
                project_id=project_id,
                actor=customer,
                pick_ids=[buy.id],
                supplier_name="Реальный поставщик",
            )
            await db.commit()

            assert len(purchase.items) == 1
            assert purchase.items[0].material_pick_id == buy.id
            assert purchase.items[0].qty == 7
            assert purchase.total_amount == 700
            assert material_supply_service.snapshot(own).qty_to_buy == 0
            assert material_supply_service.snapshot(buy).qty_to_buy == 7

            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(Purchase)
                    .where(Purchase.project_id == project_id)
                )
                or 0
            ) == 1
            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(PurchaseItem)
                    .where(PurchaseItem.material_pick_id == own.id)
                )
                or 0
            ) == 0
            assert int(
                await db.scalar(
                    select(func.count()).select_from(Payment).where(Payment.project_id == project_id)
                )
                or 0
            ) == 0
            assert int(
                await db.scalar(
                    select(func.count()).select_from(Expense).where(Expense.project_id == project_id)
                )
                or 0
            ) == 0
    finally:
        await engine.dispose()
