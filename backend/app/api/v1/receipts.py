from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Receipt, User
from app.services.fns.receipt_verify import parse_receipt_qr, verify_receipt, receipt_meta
from app.services.client_write_idempotency import IdempotencyConflict, commit_client_write, replay_entity_id


def _resolve_stage_for_room(stages, room_id: str | None) -> str | None:
    if not room_id:
        return None
    from app.services.stage_service import parse_room_ids
    from app.models.entities import StageStatus
    priority = [StageStatus.active, StageStatus.review, StageStatus.planned, StageStatus.done]
    ordered = sorted(stages, key=lambda stage: priority.index(stage.status) if stage.status in priority else 99)
    for stage in ordered:
        if room_id in parse_room_ids(stage):
            return stage.id
    return None


router = APIRouter(prefix="/projects/{project_id}/receipts", tags=["receipts"])
VALID_CATEGORIES = {"materials", "labor", "delivery", "tools", "other"}
RECEIPT_SCAN_SCOPE = "receipt.scan"
RECEIPT_MANUAL_SCOPE = "receipt.manual"


def _idempotency_http_error() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос уже использован с другими данными",
        },
    )


async def _resolve_payment_id(db, project_id: str, payment_id: str | None) -> str | None:
    if not payment_id:
        return None
    from app.models.entities import Payment, PaymentStatus
    payment = await db.get(Payment, payment_id)
    if not payment or payment.project_id != project_id:
        raise HTTPException(404, "Счёт не найден")
    if payment.status != PaymentStatus.pending:
        raise HTTPException(409, "К счёту уже нельзя прикрепить чек")
    return payment.id


async def _resolve_stage_id(db, project_id: str, stage_id: str | None, room_id: str | None) -> str | None:
    if stage_id or not room_id:
        return stage_id
    from sqlalchemy import select
    from app.models.entities import Stage
    stages = (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
    return _resolve_stage_for_room(stages, room_id)


class ReceiptScan(BaseModel):
    payment_id: str | None = None
    qr_raw: str
    expense_category: str = "materials"
    room_id: str | None = None
    stage_id: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class ReceiptManual(BaseModel):
    payment_id: str | None = None
    amount: float
    description: str = ""
    expense_category: str = "materials"
    room_id: str | None = None
    stage_id: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class ReceiptPatch(BaseModel):
    expense_category: str | None = None
    room_id: str | None = None
    stage_id: str | None = None
    amount: float | None = None
    description: str | None = None


def _scan_response(rec: Receipt, *, message: str, idempotent_replay: bool = False) -> dict:
    from app.services.fns.receipt_verify import fns_receipt_health
    health = fns_receipt_health()
    verify_mode = "live" if health.get("live_verify_ready") else ("demo" if health.get("demo_verify_allowed") else "off")
    return {
        "id": rec.id,
        "amount": rec.amount,
        "verified": rec.fns_verified,
        "verification_status": getattr(rec, "verification_status", None) or ("verified_live" if rec.fns_verified else "saved_unverified"),
        "message": message,
        "expense_category": rec.expense_category,
        "room_id": rec.room_id,
        "stage_id": rec.stage_id,
        "payment_id": rec.payment_id,
        "verify_mode": verify_mode,
        "live_verify_ready": bool(health.get("live_verify_ready")),
        "idempotent_replay": idempotent_replay,
    }


def _manual_response(rec: Receipt, *, idempotent_replay: bool = False) -> dict:
    return {
        "id": rec.id,
        "amount": rec.amount,
        "verified": True,
        "source": "manual",
        "description": rec.qr_raw,
        "room_id": rec.room_id,
        "stage_id": rec.stage_id,
        "payment_id": rec.payment_id,
        "idempotent_replay": idempotent_replay,
    }


@router.post("/scan")
async def scan_receipt(
    project_id: str,
    body: ReceiptScan,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    category = body.expense_category if body.expense_category in VALID_CATEGORIES else "materials"
    payment_id = await _resolve_payment_id(db, project_id, body.payment_id)
    stage_id = await _resolve_stage_id(db, project_id, body.stage_id, body.room_id)
    qr_raw = body.qr_raw[:500]
    payload = {
        "qr_raw": qr_raw,
        "expense_category": category,
        "room_id": body.room_id,
        "stage_id": stage_id,
        "payment_id": payment_id,
    }
    try:
        replay_id = await replay_entity_id(
            db,
            scope=RECEIPT_SCAN_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    if replay_id:
        existing = await db.get(Receipt, replay_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _scan_response(existing, message="Чек уже сохранён", idempotent_replay=True)

    parsed = parse_receipt_qr(body.qr_raw)
    check = await verify_receipt(parsed)
    rec = Receipt(
        project_id=project_id,
        amount=parsed.get("amount", 0),
        qr_raw=qr_raw,
        fn=parsed.get("fn"),
        fd=parsed.get("fd"),
        fns_verified=check["verified"],
        verification_status=(
            "verified_live" if check.get("verified") and check.get("mode") == "live"
            else "demo_verified" if check.get("verified") and check.get("mode") == "demo"
            else "verification_failed" if check.get("mode") == "live" and not check.get("verified")
            else "saved_unverified"
        ),
        expense_category=category,
        room_id=body.room_id,
        stage_id=stage_id,
        payment_id=payment_id,
    )
    db.add(rec)
    await db.flush()
    from app.services import budget_service as budget
    expense = await budget.expense_from_receipt(db, rec)
    await budget.refresh_budget_facts(db, project_id)
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=RECEIPT_SCAN_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=rec.id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    if not created:
        rec = await db.get(Receipt, entity_id)
        if not rec:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _scan_response(rec, message="Чек уже сохранён", idempotent_replay=True)

    from app.services import activity_service as activity
    await activity.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="ExpenseAdded",
        title=expense.title,
        body=str(expense.amount),
        link_path="/(customer)/(tabs)/budget",
    )
    return _scan_response(rec, message=check["message"])


@router.post("/manual")
async def manual_receipt(
    project_id: str,
    body: ReceiptManual,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Расход без QR: наличные, перевод, доставка."""
    if body.amount <= 0:
        raise HTTPException(400, "Сумма должна быть больше 0")
    await require_project(db, project_id, user, write=True)
    category = body.expense_category if body.expense_category in VALID_CATEGORIES else "materials"
    payment_id = await _resolve_payment_id(db, project_id, body.payment_id)
    stage_id = await _resolve_stage_id(db, project_id, body.stage_id, body.room_id)
    description = (body.description or "Ручной расход")[:500]
    payload = {
        "amount": round(body.amount, 2),
        "description": description,
        "expense_category": category,
        "room_id": body.room_id,
        "stage_id": stage_id,
        "payment_id": payment_id,
    }
    try:
        replay_id = await replay_entity_id(
            db,
            scope=RECEIPT_MANUAL_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    if replay_id:
        existing = await db.get(Receipt, replay_id)
        if not existing or existing.project_id != project_id:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _manual_response(existing, idempotent_replay=True)

    rec = Receipt(
        project_id=project_id,
        amount=round(body.amount, 2),
        qr_raw=description,
        fn="MANUAL",
        fd=None,
        fns_verified=True,
        expense_category=category,
        room_id=body.room_id,
        stage_id=stage_id,
        payment_id=payment_id,
    )
    db.add(rec)
    await db.flush()
    from app.services import budget_service as budget
    expense = await budget.expense_from_receipt(db, rec, title=description)
    await budget.refresh_budget_facts(db, project_id)
    try:
        created, entity_id = await commit_client_write(
            db,
            scope=RECEIPT_MANUAL_SCOPE,
            project_id=project_id,
            user_id=user.id,
            request_id=body.client_request_id,
            payload=payload,
            entity_id=rec.id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    if not created:
        rec = await db.get(Receipt, entity_id)
        if not rec:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _manual_response(rec, idempotent_replay=True)

    from app.services import activity_service as activity
    await activity.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="ExpenseAdded",
        title=expense.title,
        body=str(expense.amount),
        link_path="/(customer)/(tabs)/budget",
    )
    return _manual_response(rec)


@router.patch("/{receipt_id}")
async def patch_receipt(
    project_id: str,
    receipt_id: str,
    body: ReceiptPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=True)
    rec = await db.get(Receipt, receipt_id)
    if not rec or rec.project_id != project_id:
        raise HTTPException(404)
    if body.expense_category and body.expense_category in VALID_CATEGORIES:
        rec.expense_category = body.expense_category
    if body.room_id is not None:
        rec.room_id = body.room_id or None
    if body.amount is not None:
        if body.amount <= 0:
            raise HTTPException(400, detail="Сумма должна быть больше 0")
        old_amount = rec.amount
        rec.amount = round(body.amount, 2)
        if rec.fns_verified:
            project.budget_spent = round(max(0, (project.budget_spent or 0) - old_amount + rec.amount), 2)
    if body.description is not None and rec.fn == "MANUAL":
        rec.qr_raw = (body.description or "Ручной расход")[:500]
    if body.stage_id is not None:
        rec.stage_id = body.stage_id or None
    from app.services import budget_service as budget
    await budget.expense_from_receipt(db, rec, title=rec.qr_raw if rec.fn == "MANUAL" else None)
    await budget.refresh_budget_facts(db, project_id)
    await db.commit()
    return {
        "ok": True,
        "amount": rec.amount,
        "expense_category": rec.expense_category,
        "room_id": rec.room_id,
        "stage_id": rec.stage_id,
    }


@router.delete("/{receipt_id}")
async def delete_receipt(
    project_id: str,
    receipt_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Удалить чек и связанные расходы, пересчитать факт бюджета."""
    await require_project(db, project_id, user, write=True)
    rec = await db.get(Receipt, receipt_id)
    if not rec or rec.project_id != project_id:
        raise HTTPException(404)
    from app.services import budget_service as budget
    removed = await budget.delete_receipt_expenses(db, receipt_id, rec=rec)
    await db.delete(rec)
    await budget.refresh_budget_facts(db, project_id)
    from app.services import activity_service as activity
    await activity.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="ExpenseRemoved",
        title="Чек удалён",
        body=str(rec.amount),
        link_path="/(customer)/(tabs)/budget",
    )
    await db.commit()
    return {"ok": True, "removed_amount": rec.amount, "ledger_removed": removed}


@router.get("")
async def list_receipts(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    out = []
    for receipt in project.receipts:
        meta = receipt_meta(receipt.qr_raw)
        out.append({
            "id": receipt.id,
            "amount": receipt.amount,
            "verified": receipt.fns_verified,
            "verification_status": getattr(receipt, "verification_status", None) or ("verified_live" if receipt.fns_verified else "saved_unverified"),
            "created_at": receipt.created_at.isoformat(),
            "receipt_at": meta.get("receipt_at"),
            "fn": receipt.fn,
            "expense_category": getattr(receipt, "expense_category", "materials"),
            "room_id": getattr(receipt, "room_id", None),
            "stage_id": getattr(receipt, "stage_id", None),
            "source": "manual" if receipt.fn == "MANUAL" else "scan",
            "description": receipt.qr_raw if receipt.fn == "MANUAL" else None,
            "payment_id": getattr(receipt, "payment_id", None),
        })
    return out


@router.post("/{receipt_id}/reverify")
async def reverify_receipt(
    project_id: str,
    receipt_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """P4: повторная live-проверка сохранённого чека по QR."""
    await require_project(db, project_id, user, write=True)
    rec = await db.get(Receipt, receipt_id)
    if not rec or rec.project_id != project_id:
        raise HTTPException(404, "receipt_not_found")
    if not rec.qr_raw:
        raise HTTPException(400, "no_qr_raw")
    parsed = parse_receipt_qr(rec.qr_raw)
    check = await verify_receipt(parsed)
    from app.services.fns.receipt_verify import fns_receipt_health
    health = fns_receipt_health()
    rec.fns_verified = bool(check.get("verified"))
    mode = check.get("mode") or ("live" if health.get("live_verify_ready") else ("demo" if health.get("demo_verify_allowed") else "offline"))
    if rec.fns_verified and mode == "live":
        rec.verification_status = "verified_live"
    elif rec.fns_verified and mode == "demo":
        rec.verification_status = "demo_verified"
    elif mode == "live" and not rec.fns_verified:
        rec.verification_status = "verification_failed"
    else:
        rec.verification_status = "saved_unverified"
    verify_mode = "live" if health.get("live_verify_ready") else ("demo" if health.get("demo_verify_allowed") else "off")
    await db.commit()
    return {
        "id": rec.id,
        "verified": rec.fns_verified,
        "verification_status": getattr(rec, "verification_status", None) or ("verified_live" if rec.fns_verified else "saved_unverified"),
        "message": check.get("message"),
        "mode": check.get("mode"),
        "verify_mode": verify_mode,
        "live_verify_ready": bool(health.get("live_verify_ready")),
    }
