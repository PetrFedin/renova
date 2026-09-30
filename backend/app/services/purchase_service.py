"""Закупки Renova OS: потребность → заказ → доставка → разблокировка работ."""
import json

from app.core.timeutil import utc_now
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import material_price_truth
from app.models.entities import (
    EstimateLine,
    LineType,
    MaterialPick,
    MaterialPickStatus,
    Project,
    Purchase,
    PurchaseItem,
    PurchaseStatus,
    Stage,
)
from app.services import material_supply_service
from app.services.client_write_side_effects import PreparedSideEffect, activate_client_write_side_effects


def _uuid() -> str:
    return str(uuid4())


_PURCHASE_STATUS_RANK = {
    PurchaseStatus.draft: 0,
    PurchaseStatus.approved: 1,
    PurchaseStatus.ordered: 2,
    PurchaseStatus.partial: 3,
    PurchaseStatus.paid: 4,
    PurchaseStatus.delivered: 5,
}
_TERMINAL_PURCHASE_STATUSES = {PurchaseStatus.cancelled, PurchaseStatus.returned}


def validate_purchase_transition(current: PurchaseStatus, target: PurchaseStatus) -> None:
    if current == target:
        return
    if current in _TERMINAL_PURCHASE_STATUSES:
        raise ValueError("purchase_transition_terminal")
    if target in _TERMINAL_PURCHASE_STATUSES:
        if target == PurchaseStatus.returned and current != PurchaseStatus.delivered:
            raise ValueError("purchase_return_requires_delivery")
        return
    current_rank = _PURCHASE_STATUS_RANK.get(current)
    target_rank = _PURCHASE_STATUS_RANK.get(target)
    if current_rank is None or target_rank is None or target_rank <= current_rank:
        raise ValueError("purchase_transition_invalid")


def purchase_status_event(
    status: PurchaseStatus,
    items_count: int,
    stage_count: int,
) -> tuple[str, str, str | None]:
    if status == PurchaseStatus.delivered:
        return (
            "MaterialDelivered",
            f"Материалы доставлены: {items_count} поз.",
            f"Проверены связанные этапы: {stage_count}" if stage_count else "Связанных этапов нет",
        )
    if status == PurchaseStatus.cancelled:
        return (
            "PurchaseCancelled",
            f"Закупка отменена: {items_count} поз.",
            f"Зависимости этапов пересчитаны: {stage_count}" if stage_count else "Связанных этапов нет",
        )
    if status == PurchaseStatus.returned:
        return (
            "PurchaseReturned",
            f"Материалы возвращены: {items_count} поз.",
            f"Зависимости этапов пересчитаны: {stage_count}" if stage_count else "Связанных этапов нет",
        )
    if status == PurchaseStatus.ordered:
        return ("MaterialOrdered", f"Материалы заказаны: {items_count} поз.", None)
    if status == PurchaseStatus.paid:
        return ("PurchasePaid", f"Закупка оплачена: {items_count} поз.", None)
    if status == PurchaseStatus.partial:
        return ("PurchasePartiallyPaid", f"Закупка частично оплачена: {items_count} поз.", None)
    if status == PurchaseStatus.approved:
        return ("PurchaseApproved", f"Закупка согласована: {items_count} поз.", None)
    return ("PurchaseUpdated", f"Закупка → {status.value}", None)


def purchase_dict(purchase: Purchase) -> dict:
    return {
        "id": purchase.id,
        "project_id": purchase.project_id,
        "supplier_id": purchase.supplier_id,
        "supplier_name": purchase.supplier_name,
        "status": purchase.status.value,
        "total_amount": round(purchase.total_amount or 0, 2),
        "ordered_at": purchase.ordered_at.isoformat() if purchase.ordered_at else None,
        "paid_at": purchase.paid_at.isoformat() if purchase.paid_at else None,
        "delivered_at": purchase.delivered_at.isoformat() if purchase.delivered_at else None,
        "receipt_id": purchase.receipt_id,
        "notes": purchase.notes,
        "items": [
            {
                "id": item.id,
                "material_pick_id": item.material_pick_id,
                "name": item.name,
                "qty": item.qty,
                "unit": item.unit,
                "unit_price": item.unit_price,
                "room_id": item.room_id,
                "stage_id": item.stage_id,
                "total": round(item.qty * item.unit_price, 2),
            }
            for item in (purchase.items or [])
        ],
        "created_at": purchase.created_at.isoformat() if purchase.created_at else None,
    }


async def list_purchases(db: AsyncSession, project_id: str) -> list[Purchase]:
    result = await db.execute(
        select(Purchase)
        .where(Purchase.project_id == project_id)
        .options(selectinload(Purchase.items))
        .order_by(Purchase.created_at.desc())
    )
    return list(result.scalars().all())


async def create_from_picks(
    db: AsyncSession,
    project_id: str,
    pick_ids: list[str],
    supplier_name: str | None = None,
) -> Purchase | None:
    """Legacy compatibility path with the same supply/price eligibility truth.

    New API callers must use ``purchase_create_service`` because it additionally
    enforces actor responsibility and idempotency. This compatibility path must
    still fail closed on unknown material-price provenance.
    """
    if not pick_ids:
        return None
    result = await db.execute(
        select(MaterialPick).where(
            MaterialPick.id.in_(pick_ids),
            MaterialPick.project_id == project_id,
        )
    )
    picks = list(result.scalars().all())
    if not picks:
        return None
    not_approved = [pick for pick in picks if pick.status != MaterialPickStatus.approved]
    if not_approved:
        raise ValueError("picks_not_approved")
    purchase = Purchase(
        id=_uuid(),
        project_id=project_id,
        supplier_name=supplier_name or picks[0].shop_name,
        status=PurchaseStatus.draft,
    )
    total = 0.0
    items: list[PurchaseItem] = []
    for pick in picks:
        supply = material_supply_service.snapshot(pick)
        if not supply.buy_required:
            raise ValueError("purchase_pick_not_buy_required")
        if not material_price_truth.is_actionable_purchase_price(pick):
            raise ValueError("purchase_pick_price_unverified")
        quantity = supply.qty_to_buy
        if quantity <= 0:
            raise ValueError("purchase_pick_quantity_fulfilled")
        total += quantity * pick.price
        items.append(
            PurchaseItem(
                id=_uuid(),
                purchase=purchase,
                material_pick_id=pick.id,
                name=pick.name,
                qty=quantity,
                unit=pick.unit,
                unit_price=pick.price,
                room_id=pick.room_id,
                stage_id=pick.stage_id,
            )
        )
    purchase.total_amount = round(total, 2)
    purchase.items = items
    db.add(purchase)
    await db.commit()
    await db.refresh(purchase, ["items"])
    return purchase


def _project_member_ids(project: Project) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for user_id in [project.customer_id, project.contractor_id]:
        if user_id and user_id not in seen:
            seen.add(user_id)
            result.append(user_id)
    return result


async def _prepare_status_side_effects(
    db: AsyncSession,
    *,
    project: Project,
    purchase: Purchase,
    actor_id: str,
    status: PurchaseStatus,
) -> list[PreparedSideEffect]:
    from app.services import outbox_service as outbox

    items_count = len(purchase.items or [])
    stage_count = len({item.stage_id for item in (purchase.items or []) if item.stage_id})
    kind, title, body = purchase_status_event(status, items_count, stage_count)
    activity_row = await outbox.enqueue(
        db,
        aggregate_type="purchase",
        aggregate_id=purchase.id,
        event_type=outbox.RECEIPT_CREATED_EVENT,
        payload={
            "project_id": project.id,
            "user_id": actor_id,
            "kind": kind,
            "title": title,
            "body": body or purchase.supplier_name,
            "link_path": "/(customer)/(tabs)/repair?tab=materials",
        },
    )
    effects = [PreparedSideEffect(effect_type="activity", outbox_id=activity_row.id)]

    if status not in {PurchaseStatus.delivered, PurchaseStatus.cancelled, PurchaseStatus.returned}:
        return effects
    for user_id in _project_member_ids(project):
        if user_id == actor_id:
            continue
        notification_row = await outbox.enqueue(
            db,
            aggregate_type="purchase",
            aggregate_id=purchase.id,
            event_type=outbox.PAYMENT_CREATED_EVENT,
            payload={
                "user_id": user_id,
                "project_id": project.id,
                "notification_type": "materials",
                "title": title,
                "body": body or "Откройте материалы и проверьте влияние на ближайшие этапы.",
                "link_path": "/(customer)/(tabs)/repair?tab=materials",
                "return_to": "/(customer)/(tabs)/home",
            },
        )
        effects.append(
            PreparedSideEffect(
                effect_type="notification",
                outbox_id=notification_row.id,
                match_key=user_id,
            )
        )
    return effects


async def transition_status(
    db: AsyncSession,
    *,
    project_id: str,
    purchase_id: str,
    status: PurchaseStatus,
    actor_id: str,
) -> tuple[Purchase | None, bool]:
    """Project-scoped, row-locked and replay-safe purchase transition."""
    query = (
        select(Purchase)
        .where(Purchase.id == purchase_id, Purchase.project_id == project_id)
        .options(selectinload(Purchase.items))
    )
    try:
        query = query.with_for_update()
    except Exception:
        pass
    purchase = (await db.execute(query)).scalar_one_or_none()
    if not purchase:
        return None, False

    current = purchase.status
    validate_purchase_transition(current, status)
    if current == status:
        await db.commit()
        return purchase, False

    now = utc_now()
    purchase.status = status
    if status == PurchaseStatus.ordered and not purchase.ordered_at:
        purchase.ordered_at = now
    elif status == PurchaseStatus.paid and not purchase.paid_at:
        purchase.paid_at = now
    elif status == PurchaseStatus.delivered and not purchase.delivered_at:
        purchase.delivered_at = now
        await _on_delivered(db, purchase)
    elif status in {PurchaseStatus.cancelled, PurchaseStatus.returned}:
        await _on_reversed(db, purchase, was_delivered=current == PurchaseStatus.delivered)

    if status in {
        PurchaseStatus.paid,
        PurchaseStatus.delivered,
        PurchaseStatus.cancelled,
        PurchaseStatus.returned,
    }:
        from app.services import budget_service as budget

        await budget.refresh_budget_facts(db, purchase.project_id)

    project = await db.get(Project, project_id)
    effects = (
        await _prepare_status_side_effects(
            db,
            project=project,
            purchase=purchase,
            actor_id=actor_id,
            status=status,
        )
        if project
        else []
    )
    await db.commit()
    await db.refresh(purchase, ["items"])
    activate_client_write_side_effects(effects)
    return purchase, True


async def set_status(db: AsyncSession, purchase_id: str, status: PurchaseStatus) -> Purchase | None:
    """Compatibility wrapper; API callers should use project-scoped transition_status."""
    purchase = await db.get(Purchase, purchase_id)
    if not purchase:
        return None
    result, _ = await transition_status(
        db,
        project_id=purchase.project_id,
        purchase_id=purchase.id,
        status=status,
        actor_id="",
    )
    from app.services.client_write_side_effects import clear_request_side_effect_context

    clear_request_side_effect_context()
    return result


async def _on_reversed(
    db: AsyncSession,
    purchase: Purchase,
    *,
    was_delivered: bool,
) -> None:
    """Restore material/dependency truth without rewinding execution lifecycle."""
    from app.services import dependency_service as dependencies

    touched_stage_ids: set[str] = set()
    for item in purchase.items or []:
        pick: MaterialPick | None = None
        if item.material_pick_id:
            pick = await db.get(MaterialPick, item.material_pick_id)
            if pick:
                pick.status = MaterialPickStatus.approved
                if was_delivered:
                    pick.qty_delivered = max(0.0, (pick.qty_delivered or 0) - (item.qty or 0))
                if pick.stage_id:
                    touched_stage_ids.add(pick.stage_id)
        if item.stage_id:
            touched_stage_ids.add(item.stage_id)

    for stage_id in touched_stage_ids:
        stage = await db.get(Stage, stage_id)
        if stage:
            await dependencies.evaluate_stage(db, stage, commit=False)


async def _on_delivered(db: AsyncSession, purchase: Purchase) -> None:
    """Update material/dependency truth without manufacturing a work-start fact."""
    from app.services import dependency_service as dependencies

    for item in purchase.items or []:
        if not item.material_pick_id:
            continue
        pick = await db.get(MaterialPick, item.material_pick_id)
        if not pick:
            continue
        pick.status = MaterialPickStatus.purchased
        pick.qty_delivered = (pick.qty_delivered or 0) + (item.qty or 0)
        await dependencies.on_material_delivered(
            db,
            item.material_pick_id,
            commit=False,
        )


MATERIAL_NEEDS_GENERATE_SCOPE = "material_needs.generate"


def _material_needs_generation_payload(project_id: str) -> dict:
    # The endpoint takes no request body — the whole business intent is "run
    # the generation for this project" — so the canonical payload only needs
    # to scope the ledger row to the project. Identity is otherwise carried
    # by the (scope, project_id, actor_id, request_id) tuple itself (#419).
    return {"project_id": project_id}


async def _material_picks_from_generation(
    db: AsyncSession, generation: "MaterialNeedsGenerationResult"
) -> list[MaterialPick]:
    pick_ids = json.loads(generation.created_pick_ids_json or "[]")
    if not pick_ids:
        return []
    rows = (
        await db.execute(select(MaterialPick).where(MaterialPick.id.in_(pick_ids)))
    ).scalars().all()
    by_id = {row.id: row for row in rows}
    return [by_id[pid] for pid in pick_ids if pid in by_id]


async def generate_needs_from_estimate(
    db: AsyncSession,
    project_id: str,
    *,
    actor_id: str | None = None,
    client_request_id: str | None = None,
) -> list[MaterialPick]:
    """Сформировать потребности в материалах из строк сметы — атомарно и replay-safe (#419).

    Bug fixed here: the previous implementation committed each `MaterialPick`
    insert inside the loop, then a separate, unlinked `act.log_event` call
    recorded the `MaterialCalculated` activity in its own transaction after
    the route returned control here. That left two real recovery holes: (1)
    two concurrent calls could both observe "no existing pick" for the same
    estimate line and both insert it (no serialization contract), and (2) a
    crash/network loss between the material commit and the activity commit
    permanently split the material truth from its audit evidence, with nothing
    to reconstruct it on replay.

    Fixed by making the whole generation — every `MaterialPick` insert, the
    `MaterialNeedsGenerationResult` evidence row, the durable `MaterialCalculated`
    activity outbox row, and the `ClientWriteRequest` idempotency ledger row —
    one atomic commit (mirrors `calendar_import_service.import_ical_atomic`,
    #422). Concurrent calls for the same project are serialized with a
    `SELECT ... FOR UPDATE` on the `Project` row before the estimate-line scan,
    so two racing sessions cannot both decide to insert the same pick.
    Replay safety is scoped to (project, actor, request id): the same
    request id with the same (empty) payload returns the original generated
    set verbatim; reusing it after a real code/schema change to the payload
    would raise `IdempotencyConflict`. When no `client_request_id` is
    supplied (direct/legacy callers), the call is not ledgered and always
    performs a fresh (still dedupe-by-name/room, still atomic) scan.
    """
    from app.models.material_needs_generation import MaterialNeedsGenerationResult
    from app.services import outbox_service as outbox
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id
    from app.services.client_write_side_effects import (
        PreparedSideEffect,
        activate_client_write_side_effects,
        clear_request_side_effect_context,
    )

    project = await db.get(Project, project_id)
    if not project:
        return []

    resolved_actor_id = actor_id or project.customer_id or project.contractor_id or "system"
    payload = _material_needs_generation_payload(project_id)

    replay_id = await replay_entity_id(
        db,
        scope=MATERIAL_NEEDS_GENERATE_SCOPE,
        project_id=project_id,
        user_id=resolved_actor_id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id is not None:
        existing = await db.get(MaterialNeedsGenerationResult, replay_id)
        if not existing:
            raise ValueError("material_needs_generation_idempotency_target_missing")
        return await _material_picks_from_generation(db, existing)

    # Serialize concurrent generation attempts for this project: two sessions
    # racing this endpoint must not both observe "no existing pick" for the
    # same estimate line and both insert it (#419 concurrent-duplicate defect).
    lock_query = select(Project).where(Project.id == project_id)
    try:
        lock_query = lock_query.with_for_update()
    except Exception:
        pass
    locked_project = (await db.execute(lock_query)).scalar_one_or_none()
    if not locked_project:
        return []

    generated_source = material_supply_service.default_source_for_project(locked_project)
    result = await db.execute(
        select(EstimateLine).where(
            EstimateLine.project_id == project_id,
            EstimateLine.line_type == LineType.material,
        )
    )
    lines = list(result.scalars().all())

    existing_picks = await db.execute(
        select(MaterialPick).where(MaterialPick.project_id == project_id)
    )
    # Snapshot of already-generated picks taken once, under the project lock,
    # before any mutation — mirrors the calendar-import fallback-mapping
    # snapshot so a replay (or a second racing call, once unblocked by the
    # lock) never double-inserts against a partially-applied prior attempt.
    existing_by_key = {(pick.name, pick.room_id): pick for pick in existing_picks.scalars().all()}

    created: list[MaterialPick] = []
    for line in lines:
        key = (line.name, line.room_id)
        if key in existing_by_key:
            continue
        pick = MaterialPick(
            project_id=project_id,
            room_id=line.room_id,
            name=line.name,
            qty=line.quantity_planned,
            qty_needed=line.quantity_planned,
            unit=line.unit,
            price=line.unit_price,
            price_source="estimate" if float(line.unit_price or 0) > 0 else "unset",
            category=line.category or "materials",
            work_type=line.category,
            status=MaterialPickStatus.draft,
            supply_source=generated_source,
            qty_available=0,
            notes="Из сметы",
        )
        db.add(pick)
        created.append(pick)
        existing_by_key[key] = pick  # guard duplicate estimate lines within this same batch

    try:
        await db.flush()  # assign pick ids before persisting the result/ledger rows

        generation = MaterialNeedsGenerationResult(
            project_id=project_id,
            created_pick_ids_json=json.dumps([pick.id for pick in created]),
            created_count=len(created),
        )
        db.add(generation)
        await db.flush()

        activity_row = None
        if created:
            activity_row = await outbox.enqueue(
                db,
                aggregate_type="material_needs_generation",
                aggregate_id=generation.id,
                event_type=outbox.ACTIVITY_EVENT,
                payload={
                    "project_id": project_id,
                    "user_id": resolved_actor_id,
                    "kind": "MaterialCalculated",
                    "title": f"Материалы из сметы: {len(created)}",
                    "link_path": "/(customer)/(tabs)/repair?tab=materials",
                },
            )

        committed, canonical_id = await commit_client_write(
            db,
            scope=MATERIAL_NEEDS_GENERATE_SCOPE,
            project_id=project_id,
            user_id=resolved_actor_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=generation.id,
        )
    except BaseException:
        await db.rollback()
        clear_request_side_effect_context()
        raise

    if not committed:
        # Lost the idempotency race to a concurrent identical request that
        # committed first: return its canonical result instead of ours.
        existing = await db.get(MaterialNeedsGenerationResult, canonical_id)
        if not existing:
            raise ValueError("material_needs_generation_idempotency_target_missing")
        return await _material_picks_from_generation(db, existing)

    if created and activity_row:
        from app.services import activity_service as act

        activate_client_write_side_effects(
            [PreparedSideEffect(effect_type="activity", outbox_id=activity_row.id)]
        )
        try:
            await act.log_event(
                db,
                project_id=project_id,
                user_id=resolved_actor_id,
                kind="MaterialCalculated",
                title=f"Материалы из сметы: {len(created)}",
                link_path="/(customer)/(tabs)/repair?tab=materials",
            )
        finally:
            clear_request_side_effect_context()

    for pick in created:
        await db.refresh(pick)
    return created
