from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import Payment, PaymentStatus, Receipt, Stage, User
from app.services import receipt_integrity_service as receipt_svc
from app.services.client_write_idempotency import IdempotencyConflict, commit_client_write, replay_entity_id
from app.services.fns.receipt_verify import parse_receipt_qr, receipt_meta, verify_receipt


router = APIRouter(prefix="/projects/{project_id}/receipts", tags=["receipts"])
VALID_CATEGORIES = {"materials", "labor", "delivery", "tools", "other"}
RECEIPT_SCAN_SCOPE = "receipt.scan"
RECEIPT_MANUAL_SCOPE = "receipt.manual"


def _resolve_stage_for_room(stages, room_id: str | None) -> str | None:
    if not room_id:
        return None
    from app.models.entities import StageStatus
    from app.services.stage_service import parse_room_ids

    priority = [StageStatus.active, StageStatus.review, StageStatus.planned, StageStatus.done]
    ordered = sorted(stages, key=lambda stage: priority.index(stage.status) if stage.status in priority else 99)
    for stage in ordered:
        if room_id in parse_room_ids(stage):
            return stage.id
    return None


def _idempotency_http_error() -> HTTPException:
    return HTTPException(
        409,
        detail={
            "code": "idempotency_conflict",
            "message": "Этот запрос уже использован с другими данными",
        },
    )


def _receipt_error(error: ValueError) -> HTTPException:
    code = str(error)
    messages = {
        "receipt_room_not_found": "Комната не найдена в этом проекте",
        "receipt_stage_not_found": "Этап не найден в этом проекте",
        "receipt_amount_invalid": "Сумма должна быть больше 0",
        "fiscal_receipt_amount_immutable": "Сумма QR-чека определяется фискальными данными и не редактируется",
        "fiscal_receipt_description_immutable": "Описание QR-чека определяется фискальными данными и не редактируется",
        "manual_receipt_not_reverifiable": "Ручной расход нельзя проверить через ФНС",
        "confirmed_payment_receipt_locked": "Нельзя удалить чек, подтверждающий завершённую оплату",
        "receipt_not_found": "Чек не найден",
    }
    status = 404 if code == "receipt_not_found" else 422 if code in {
        "receipt_room_not_found",
        "receipt_stage_not_found",
        "receipt_amount_invalid",
    } else 409
    return HTTPException(status, detail={"code": code, "message": messages.get(code, "Операция с чеком недоступна")})


async def _resolve_payment_id(db: AsyncSession, project_id: str, payment_id: str | None) -> str | None:
    if not payment_id:
        return None
    payment = (
        await db.execute(
            select(Payment).where(Payment.id == payment_id, Payment.project_id == project_id).limit(1)
        )
    ).scalar_one_or_none()
    if not payment:
        raise HTTPException(404, "Счёт не найден")
    if payment.status != PaymentStatus.pending:
        raise HTTPException(409, "К счёту уже нельзя прикрепить чек")
    return payment.id


async def _resolve_receipt_links(
    db: AsyncSession,
    *,
    project_id: str,
    room_id: str | None,
    stage_id: str | None,
) -> tuple[str | None, str | None]:
    try:
        resolved_room_id = await receipt_svc.resolve_room_id(
            db,
            project_id=project_id,
            room_id=room_id,
        )
        if stage_id:
            resolved_stage_id = await receipt_svc.resolve_stage_id(
                db,
                project_id=project_id,
                stage_id=stage_id,
            )
        elif resolved_room_id:
            stages = (
                await db.execute(select(Stage).where(Stage.project_id == project_id))
            ).scalars().all()
            resolved_stage_id = _resolve_stage_for_room(stages, resolved_room_id)
        else:
            resolved_stage_id = None
    except ValueError as error:
        raise _receipt_error(error) from error
    return resolved_room_id, resolved_stage_id


class ReceiptScan(BaseModel):
    payment_id: str | None = None
    qr_raw: str = Field(min_length=1, max_length=500)
    expense_category: str = "materials"
    room_id: str | None = None
    stage_id: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class ReceiptManual(BaseModel):
    payment_id: str | None = None
    amount: float = Field(gt=0)
    description: str = ""
    expense_category: str = "materials"
    room_id: str | None = None
    stage_id: str | None = None
    client_request_id: str | None = Field(default=None, min_length=8, max_length=80)


class ReceiptPatch(BaseModel):
    expense_category: str | None = None
    room_id: str | None = None
    stage_id: str | None = None
    amount: float | None = Field(default=None, gt=0)
    description: str | None = None


def _scan_response(rec: Receipt, *, message: str, idempotent_replay: bool = False) -> dict:
    from app.services.fns.receipt_verify import fns_receipt_health

    health = fns_receipt_health()
    verify_mode = "live" if health.get("live_verify_ready") else ("demo" if health.get("demo_verify_allowed") else "off")
    return {
        "id": rec.id,
        "amount": rec.amount,
        "verified": rec.fns_verified,
        "verification_status": rec.verification_status or ("verified_live" if rec.fns_verified else "saved_unverified"),
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
    room_id, stage_id = await _resolve_receipt_links(
        db,
        project_id=project_id,
        room_id=body.room_id,
        stage_id=body.stage_id,
    )
    qr_raw = body.qr_raw[:500]
    payload = {
        "qr_raw": qr_raw,
        "expense_category": category,
        "room_id": room_id,
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
    except IdempotencyConflict as error:
        raise _idempotency_http_error() from error
    if replay_id:
        existing = await receipt_svc.get_receipt(db, project_id=project_id, receipt_id=replay_id)
        if not existing:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _scan_response(existing, message="Чек уже сохранён", idempotent_replay=True)

    parsed = parse_receipt_qr(body.qr_raw)
    check = await verify_receipt(parsed)
    verified = bool(check.get("verified"))
    mode = check.get("mode") or "offline"
    rec = Receipt(
        project_id=project_id,
        amount=parsed.get("amount", 0),
        qr_raw=qr_raw,
        fn=parsed.get("fn"),
        fd=parsed.get("fd"),
        fns_verified=verified,
        verification_status=receipt_svc.verification_status(verified=verified, mode=mode),
        expense_category=category,
        room_id=room_id,
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
    except IdempotencyConflict as error:
        raise _idempotency_http_error() from error
    if not created:
        existing = await receipt_svc.get_receipt(db, project_id=project_id, receipt_id=entity_id)
        if not existing:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _scan_response(existing, message="Чек уже сохранён", idempotent_replay=True)

    from app.services import activity_service as activity
    from app.services.client_write_side_effects import clear_request_side_effect_context

    try:
        await activity.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="ExpenseAdded",
            title=expense.title,
            body=str(expense.amount),
            link_path="/(customer)/(tabs)/budget",
        )
    finally:
        clear_request_side_effect_context()
    return _scan_response(rec, message=check.get("message") or "Чек сохранён")


@router.post("/manual")
async def manual_receipt(
    project_id: str,
    body: ReceiptManual,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    category = body.expense_category if body.expense_category in VALID_CATEGORIES else "materials"
    payment_id = await _resolve_payment_id(db, project_id, body.payment_id)
    room_id, stage_id = await _resolve_receipt_links(
        db,
        project_id=project_id,
        room_id=body.room_id,
        stage_id=body.stage_id,
    )
    description = (body.description or "Ручной расход")[:500]
    payload = {
        "amount": round(body.amount, 2),
        "description": description,
        "expense_category": category,
        "room_id": room_id,
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
    except IdempotencyConflict as error:
        raise _idempotency_http_error() from error
    if replay_id:
        existing = await receipt_svc.get_receipt(db, project_id=project_id, receipt_id=replay_id)
        if not existing:
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
        room_id=room_id,
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
    except IdempotencyConflict as error:
        raise _idempotency_http_error() from error
    if not created:
        existing = await receipt_svc.get_receipt(db, project_id=project_id, receipt_id=entity_id)
        if not existing:
            raise HTTPException(409, detail={"code": "idempotency_target_missing"})
        return _manual_response(existing, idempotent_replay=True)

    from app.services import activity_service as activity
    from app.services.client_write_side_effects import clear_request_side_effect_context

    try:
        await activity.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="ExpenseAdded",
            title=expense.title,
            body=str(expense.amount),
            link_path="/(customer)/(tabs)/budget",
        )
    finally:
        clear_request_side_effect_context()
    return _manual_response(rec)


@router.patch("/{receipt_id}")
async def patch_receipt(
    project_id: str,
    receipt_id: str,
    body: ReceiptPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    if body.expense_category is not None and body.expense_category not in VALID_CATEGORIES:
        raise HTTPException(422, detail={"code": "receipt_category_invalid"})
    fields = body.model_fields_set
    try:
        rec = await receipt_svc.patch_receipt(
            db,
            project_id=project_id,
            receipt_id=receipt_id,
            expense_category=body.expense_category,
            room_id_supplied="room_id" in fields,
            room_id=body.room_id,
            stage_id_supplied="stage_id" in fields,
            stage_id=body.stage_id,
            amount=body.amount,
            description_supplied="description" in fields,
            description=body.description,
        )
    except ValueError as error:
        raise _receipt_error(error) from error
    if not rec:
        raise HTTPException(404)
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
    await require_project(db, project_id, user, write=True)
    try:
        result = await receipt_svc.delete_receipt(
            db,
            project_id=project_id,
            receipt_id=receipt_id,
            actor_id=user.id,
        )
    except ValueError as error:
        raise _receipt_error(error) from error
    if not result:
        raise HTTPException(404)

    from app.services import activity_service as activity
    from app.services.client_write_side_effects import clear_request_side_effect_context

    try:
        await activity.log_event(
            db,
            project_id=project_id,
            user_id=user.id,
            kind="ExpenseRemoved",
            title="Чек удалён",
            body=str(result.amount),
            link_path="/(customer)/(tabs)/budget",
        )
    finally:
        clear_request_side_effect_context()
    return {
        "ok": True,
        "removed_amount": result.amount,
        "ledger_removed": result.ledger_removed,
    }


@router.get("")
async def list_receipts(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=False)
    receipts = list(
        (
            await db.execute(
                select(Receipt)
                .where(Receipt.project_id == project_id)
                .order_by(Receipt.created_at.desc())
            )
        ).scalars().all()
    )
    out = []
    for receipt in receipts:
        meta = receipt_meta(receipt.qr_raw)
        out.append(
            {
                "id": receipt.id,
                "amount": receipt.amount,
                "verified": receipt.fns_verified,
                "verification_status": receipt.verification_status or ("verified_live" if receipt.fns_verified else "saved_unverified"),
                "created_at": receipt.created_at.isoformat(),
                "receipt_at": meta.get("receipt_at"),
                "fn": receipt.fn,
                "expense_category": receipt.expense_category,
                "room_id": receipt.room_id,
                "stage_id": receipt.stage_id,
                "source": "manual" if receipt.fn == "MANUAL" else "scan",
                "description": receipt.qr_raw if receipt.fn == "MANUAL" else None,
                "payment_id": receipt.payment_id,
            }
        )
    return out


@router.post("/{receipt_id}/reverify")
async def reverify_receipt(
    project_id: str,
    receipt_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    rec = await receipt_svc.get_receipt(db, project_id=project_id, receipt_id=receipt_id)
    if not rec:
        raise HTTPException(404, detail={"code": "receipt_not_found"})
    if rec.fn == "MANUAL":
        raise _receipt_error(ValueError("manual_receipt_not_reverifiable"))
    if not rec.qr_raw:
        raise HTTPException(400, detail={"code": "no_qr_raw"})

    qr_raw = rec.qr_raw
    parsed = parse_receipt_qr(qr_raw)
    check = await verify_receipt(parsed)
    from app.services.fns.receipt_verify import fns_receipt_health

    health = fns_receipt_health()
    mode = check.get("mode") or ("live" if health.get("live_verify_ready") else ("demo" if health.get("demo_verify_allowed") else "offline"))
    try:
        mutation = await receipt_svc.apply_verification_result(
            db,
            project_id=project_id,
            receipt_id=receipt_id,
            actor_id=user.id,
            verified=bool(check.get("verified")),
            mode=mode,
            message=check.get("message"),
        )
    except ValueError as error:
        raise _receipt_error(error) from error

    if mutation.changed:
        from app.services import activity_service as activity
        from app.services.client_write_side_effects import clear_request_side_effect_context

        kind = "ReceiptVerified" if mutation.receipt.fns_verified else "ReceiptVerificationFailed"
        title = "Чек подтверждён ФНС" if mutation.receipt.fns_verified else "Проверка чека не пройдена"
        try:
            await activity.log_event(
                db,
                project_id=project_id,
                user_id=user.id,
                kind=kind,
                title=title,
                body=check.get("message") or str(mutation.receipt.amount),
                room_id=mutation.receipt.room_id,
                link_path="/(customer)/(tabs)/budget",
            )
        finally:
            clear_request_side_effect_context()

    verify_mode = "live" if health.get("live_verify_ready") else ("demo" if health.get("demo_verify_allowed") else "off")
    return {
        "id": mutation.receipt.id,
        "verified": mutation.receipt.fns_verified,
        "verification_status": mutation.receipt.verification_status,
        "message": check.get("message"),
        "mode": check.get("mode"),
        "verify_mode": verify_mode,
        "live_verify_ready": bool(health.get("live_verify_ready")),
        "replayed": not mutation.changed,
    }
