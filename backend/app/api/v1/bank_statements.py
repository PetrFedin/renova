"""Canonical bank statement preview, expense import and payment confirmation."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, UserRole
from app.services import bank_statement_integrity as integrity
from app.services.integrations.bank_import import match_bank_rows_to_payments, parse_bank_statement_csv

router = APIRouter(prefix="/projects", tags=["bank-statements"])


class BankStatementIn(BaseModel):
    csv_text: str = Field(min_length=1, max_length=2_000_000)
    create_expenses: bool = False


class BankConfirmIn(BaseModel):
    payment_ids: list[str] = Field(default_factory=list, min_length=1, max_length=100)
    match_token: str = Field(min_length=32, max_length=200_000)


def _token_error(error: ValueError) -> HTTPException:
    code = str(error)
    messages = {
        "bank_match_token_invalid": "Подтверждение импорта повреждено или недействительно",
        "bank_match_token_expired": "Срок подтверждения импорта истёк — загрузите выписку снова",
        "bank_match_token_scope_mismatch": "Импорт относится к другому проекту или пользователю",
        "bank_payment_ids_required": "Не выбраны оплаты для подтверждения",
        "bank_match_not_authorized": "Оплата не подтверждена результатом этого импорта",
    }
    status = 401 if code in {"bank_match_token_invalid", "bank_match_token_expired"} else 403
    return HTTPException(status, detail={"code": code, "message": messages.get(code, "Импорт нельзя подтвердить")})


@router.post("/{project_id}/import/bank-statement")
async def import_bank_statement(
    project_id: str,
    body: BankStatementIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Parse and match a statement; optionally create unmatched expenses once."""
    project = await require_project(db, project_id, user, write=bool(body.create_expenses))
    rows = integrity.annotate_statement_rows(parse_bank_statement_csv(body.csv_text))
    if not rows:
        raise HTTPException(400, "Не удалось разобрать CSV (нужны сумма и опционально дата)")

    result = await match_bank_rows_to_payments(db, project, rows)
    matches = list(result.get("matches") or [])
    match_token = integrity.create_match_token(
        project_id=project_id,
        user_id=user.id,
        matches=matches,
    )
    expenses_meta: dict = {"expenses_created": 0, "expenses_replayed": 0, "expense_ids": []}
    if body.create_expenses and result.get("unmatched_statement_rows"):
        expenses_meta = await integrity.create_expenses_from_rows(
            db,
            project_id=project_id,
            actor_id=user.id,
            rows=list(result["unmatched_statement_rows"]),
        )

    return {
        "ok": True,
        "parsed_rows": len(rows),
        **result,
        **expenses_meta,
        "match_token": match_token,
    }


@router.post("/{project_id}/import/bank-statement/confirm")
async def confirm_bank_statement_matches(
    project_id: str,
    body: BankConfirmIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm only payments proven by a signed match result for this customer/project."""
    project = await require_project(db, project_id, user, write=True)
    if user.role != UserRole.customer or user.id != project.customer_id:
        raise HTTPException(403, detail={"code": "bank_confirm_customer_only", "message": "Оплаты по выписке подтверждает заказчик"})
    try:
        claims = integrity.verify_match_token(
            body.match_token,
            project_id=project_id,
            user_id=user.id,
            payment_ids=body.payment_ids,
        )
    except ValueError as error:
        raise _token_error(error) from error

    result = await integrity.confirm_matches(
        db,
        project=project,
        actor_id=user.id,
        claims=claims,
    )
    return {
        "ok": True,
        "confirmed": result.confirmed,
        "replayed": result.replayed,
        "blocked": result.blocked,
        "confirmed_count": len(result.confirmed),
        "replayed_count": len(result.replayed),
        "blocked_count": len(result.blocked),
    }
