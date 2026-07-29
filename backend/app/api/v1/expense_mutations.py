"""Canonical direct Expense PATCH/DELETE routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import budget_service as budget
from app.services import expense_integrity_service as integrity

router = APIRouter(prefix="/projects/{project_id}/os/expenses", tags=["expense-mutations"])


class ExpensePatch(BaseModel):
    amount: float | None = Field(default=None, gt=0)
    title: str | None = Field(default=None, max_length=255)
    category: str | None = Field(default=None, max_length=32)
    room_id: str | None = None
    stage_id: str | None = None


def _expense_error(error: ValueError) -> HTTPException:
    code = str(error)
    source = code.split(":", 1)[1] if code.startswith("expense_source_locked:") else None
    source_messages = {
        "receipt": "Расход создан чеком — измените или удалите чек",
        "payment": "Расход создан подтверждённой оплатой — измените источник оплаты",
        "purchase": "Расход создан закупкой — измените закупку",
        "material_pick": "Расход связан с материалом — измените источник материала",
    }
    messages = {
        "expense_room_not_found": "Комната не найдена в этом проекте",
        "expense_stage_not_found": "Этап не найден в этом проекте",
        "expense_amount_invalid": "Сумма должна быть больше 0",
        "expense_title_required": "Название расхода обязательно",
        "expense_category_invalid": "Недопустимая категория расхода",
        "bank_expense_amount_immutable": "Сумма операции определяется банковской выпиской",
        "bank_expense_title_immutable": "Назначение операции определяется банковской выпиской",
    }
    if source:
        return HTTPException(409, detail={"code": "expense_source_locked", "source": source, "message": source_messages.get(source, "Измените канонический источник расхода")})
    status = 404 if code in {"expense_room_not_found", "expense_stage_not_found"} else 422
    return HTTPException(status, detail={"code": code, "message": messages.get(code, "Операция с расходом недоступна")})


@router.patch("/{expense_id}")
async def patch_expense(
    project_id: str,
    expense_id: str,
    body: ExpensePatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    supplied = body.model_fields_set
    try:
        mutation = await integrity.patch_expense(
            db,
            project_id=project_id,
            expense_id=expense_id,
            actor_id=user.id,
            amount_supplied="amount" in supplied,
            amount=body.amount,
            title_supplied="title" in supplied,
            title=body.title,
            category_supplied="category" in supplied,
            category=body.category,
            room_id_supplied="room_id" in supplied,
            room_id=body.room_id,
            stage_id_supplied="stage_id" in supplied,
            stage_id=body.stage_id,
        )
    except ValueError as error:
        await db.rollback()
        raise _expense_error(error) from error
    if not mutation:
        raise HTTPException(404, detail={"code": "expense_not_found", "message": "Расход не найден"})
    return {
        **budget.expense_dict(mutation.expense),
        "changed": mutation.changed,
        "replayed": mutation.replayed,
    }


@router.delete("/{expense_id}")
async def delete_expense(
    project_id: str,
    expense_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project(db, project_id, user, write=True)
    try:
        mutation = await integrity.delete_expense(
            db,
            project_id=project_id,
            expense_id=expense_id,
            actor_id=user.id,
        )
    except ValueError as error:
        await db.rollback()
        raise _expense_error(error) from error
    if not mutation:
        raise HTTPException(404, detail={"code": "expense_not_found", "message": "Расход не найден"})
    return {
        "ok": True,
        "expense_id": mutation.expense.id,
        "replayed": mutation.replayed,
    }
