"""Race-safe material price synchronization with durable audit evidence."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import MaterialPick, MaterialPickStatus
from app.models import material_price_truth
from app.services import material_pick_service as picks
from app.services import outbox_service as outbox
from app.services.price_parser import PriceFetchResult, fetch_price


@dataclass(frozen=True)
class MaterialPriceSyncResult:
    pick: MaterialPick
    source: str
    price_changed: bool
    shop_changed: bool
    final_url: str | None


async def _validate_snapshot(
    db: AsyncSession,
    *,
    project_id: str,
    pick_id: str,
) -> MaterialPick | None:
    pick = await picks.get_pick(db, project_id=project_id, pick_id=pick_id)
    if pick is None:
        return None
    if pick.status != MaterialPickStatus.draft:
        raise ValueError("material_pick_not_editable")
    if await picks.material_pick_has_active_purchase(
        db,
        project_id=project_id,
        pick_id=pick_id,
    ):
        raise ValueError("material_pick_locked_by_purchase")
    return pick


async def _commit_with_activity(
    db: AsyncSession,
    *,
    pick: MaterialPick,
    project_id: str,
    actor_id: str,
    kind: str,
    title: str,
    body: str,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="material_pick",
        aggregate_id=pick.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project_id,
            "user_id": actor_id,
            "kind": kind,
            "title": title,
            "body": body,
            "room_id": pick.room_id,
            "work_type": pick.work_type,
            "link_path": "/(customer)/(tabs)/repair?tab=materials",
        },
    )
    try:
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(pick)

    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(
        db,
        source="material_price.mutation",
        limit=10,
    )


async def set_manual_material_price(
    db: AsyncSession,
    *,
    project_id: str,
    pick_id: str,
    actor_id: str,
    price: float,
) -> MaterialPick | None:
    """Set or clear an editable draft price and persist explicit provenance."""
    normalized = round(float(price), 2)
    if normalized < 0 or normalized > 10_000_000:
        raise ValueError("material_pick_price_invalid")

    pick = await picks.require_editable_pick(
        db,
        project_id=project_id,
        pick_id=pick_id,
    )
    if pick is None:
        return None

    target_source = "manual" if normalized > 0 else "unset"
    if (
        round(float(pick.price or 0), 2) == normalized
        and pick.price_source == target_source
        and pick.price_verified_at is None
        and pick.price_source_url is None
    ):
        await db.commit()
        return pick

    old_price = round(float(pick.price or 0), 2)
    pick.price = normalized
    pick.price_source = target_source
    pick.price_verified_at = None
    pick.price_source_url = None
    await _commit_with_activity(
        db,
        pick=pick,
        project_id=project_id,
        actor_id=actor_id,
        kind="MaterialPriceSet",
        title=f"Указана цена материала: {pick.name}",
        body=f"{old_price:.2f} → {normalized:.2f} ₽ · вручную",
    )
    return pick


async def sync_material_price(
    db: AsyncSession,
    *,
    project_id: str,
    pick_id: str,
    actor_id: str,
) -> MaterialPriceSyncResult | None:
    """Fetch without a DB lock, then compare-and-commit under a fresh row lock."""
    snapshot = await _validate_snapshot(
        db,
        project_id=project_id,
        pick_id=pick_id,
    )
    if snapshot is None:
        return None

    snapshot_url = (snapshot.shop_url or "").strip() or None
    snapshot_price = round(float(snapshot.price or 0), 2)
    snapshot_shop = (snapshot.shop_name or "").strip() or None

    if snapshot_url is None:
        await db.commit()
        await db.refresh(snapshot)
        return MaterialPriceSyncResult(
            pick=snapshot,
            source="no_url",
            price_changed=False,
            shop_changed=False,
            final_url=None,
        )

    # Do not hold a row/transaction lock while waiting on an external supplier.
    await db.rollback()
    fetched: PriceFetchResult = await fetch_price(snapshot_url, snapshot_price)

    current = await picks.require_editable_pick(
        db,
        project_id=project_id,
        pick_id=pick_id,
    )
    if current is None:
        return None
    current_url = (current.shop_url or "").strip() or None
    current_price = round(float(current.price or 0), 2)
    current_shop = (current.shop_name or "").strip() or None
    if (
        current_url != snapshot_url
        or current_price != snapshot_price
        or current_shop != snapshot_shop
    ):
        await db.rollback()
        raise ValueError("material_pick_price_sync_stale")

    price_changed = False
    shop_changed = False
    if fetched.verified_live:
        if fetched.price != current_price:
            current.price = fetched.price
            price_changed = True
        current.price_source = fetched.source
        current.price_verified_at = utc_now()
        current.price_source_url = fetched.final_url or snapshot_url
    if fetched.shop != "generic" and not current_shop:
        current.shop_name = fetched.shop
        shop_changed = True

    if fetched.verified_live:
        title = (
            f"Обновлена цена материала: {current.name}"
            if price_changed
            else f"Проверена цена материала: {current.name}"
        )
        body = (
            f"{snapshot_price:.2f} → {fetched.price:.2f} ₽ · {fetched.source}"
            if price_changed
            else f"{fetched.price:.2f} ₽ · подтверждено {fetched.source}"
        )
        await _commit_with_activity(
            db,
            pick=current,
            project_id=project_id,
            actor_id=actor_id,
            kind="MaterialPriceSynced",
            title=title,
            body=body,
        )
    else:
        # Provider/parser unavailability must never overwrite the last known
        # price or its provenance. A harmless supplier-name enrichment may still
        # be committed, but the canonical monetary truth is left untouched.
        try:
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        await db.refresh(current)

    return MaterialPriceSyncResult(
        pick=current,
        source=fetched.source,
        price_changed=price_changed,
        shop_changed=shop_changed,
        final_url=fetched.final_url,
    )
