"""Canonical project lead-assignment routes with race-safe status semantics."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from sqlalchemy import select
from app.models.entities import ContractorProfile, Project, User, UserRole
from app.services import project_assignment_request_service as requests
from app.services import project_assignment_service as assignment

router = APIRouter(prefix="/projects", tags=["projects"])


class LinkContractorIn(BaseModel):
    contractor_id: str = Field(min_length=1, max_length=36)


def _assignment_error(status: str) -> HTTPException:
    errors = {
        "not_found": (404, "project_not_found", "Объект не найден"),
        "already_assigned": (409, "already_assigned", "На объекте уже другой исполнитель"),
        "subscription_required": (402, "subscription_required", "Нужен Pro для нового объекта"),
        "forbidden": (403, "customer_owner_only", "Недостаточно прав для назначения исполнителя"),
        "project_trashed": (409, "project_trashed", "Сначала восстановите объект из корзины"),
        "contractor_invalid": (404, "contractor_not_found", "Исполнитель не найден"),
    }
    code, detail, message = errors.get(
        status, (409, "project_assignment_failed", "Не удалось назначить исполнителя"),
    )
    return HTTPException(code, detail={"code": detail, "message": message})


async def _detail(db: AsyncSession, project: Project, user: User):
    from app.api.v1.projects import _detail as project_detail

    return await project_detail(db, project, user)


def _request_out(r) -> dict:
    return {
        "id": r.id, "project_id": r.project_id, "contractor_id": r.contractor_id,
        "status": r.status, "message": r.message,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
    }


_REQUEST_ERRORS = {
    "not_found": (404, "project_not_found", "Объект не найден"),
    "forbidden": (403, "forbidden", "Недостаточно прав"),
    "project_trashed": (409, "project_trashed", "Сначала восстановите объект из корзины"),
    "already_assigned": (409, "already_assigned", "На объекте уже другой исполнитель. Сначала снимите его."),
    "request_not_found": (404, "request_not_found", "Заявка не найдена"),
    "request_not_pending": (409, "request_not_pending", "Заявка уже обработана"),
    "no_contractor": (409, "no_contractor", "На объекте нет исполнителя"),
    "subscription_required": (
        402, "subscription_required",
        "У исполнителя исчерпан лимит бесплатных объектов. Мы сообщили ему — попросите оформить Pro.",
    ),
    "contractor_invalid": (404, "contractor_not_found", "Исполнитель не найден"),
}


def _request_error(status: str) -> HTTPException:
    code, detail, message = _REQUEST_ERRORS.get(
        status, (409, "project_assignment_failed", "Не удалось выполнить действие"),
    )
    return HTTPException(code, detail={"code": detail, "message": message})


class AssignmentRequestIn(BaseModel):
    message: str | None = Field(default=None, max_length=1000)


class JoinByCodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    message: str | None = Field(default=None, max_length=1000)


@router.get("/me/assignment-requests")
async def my_assignment_requests(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_only"})
    rows = await requests.my_requests(db, contractor_id=user.id)
    return {"items": [{**_request_out(r), "project_name": name} for r, name in rows]}


@router.post("/join-by-code/claim")
async def claim_by_code(
    body: JoinByCodeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """ROLE-007: the customer's object code opens a request, never access."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_only"})
    project_id = await requests.find_open_project_by_code(db, body.code)
    if project_id is None:
        raise HTTPException(404, detail={
            "code": "project_code_not_found",
            "message": "Объект с таким кодом не найден или у него уже есть исполнитель",
        })
    result = await requests.request_assignment(
        db, project_id=project_id, contractor_id=user.id, message=body.message,
    )
    if result.status != "pending" or result.request is None:
        raise _request_error(result.status)
    return JSONResponse(
        {"status": "pending_customer_confirmation", "created": result.created,
         "request": _request_out(result.request)},
        status_code=202,
    )


@router.post("/{project_id}/assign")
async def assign_contractor(
    project_id: str,
    body: AssignmentRequestIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Contractor's own wish to lead: creates a pending request, never assigns."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, detail={"code": "contractor_only"})
    result = await requests.request_assignment(
        db, project_id=project_id, contractor_id=user.id,
        message=body.message if body else None,
    )
    if result.status == "already_lead":
        return {"status": "assigned", "request": None}
    if result.status != "pending" or result.request is None:
        raise _request_error(result.status)
    return JSONResponse(
        {"status": "pending_customer_confirmation", "created": result.created,
         "request": _request_out(result.request)},
        status_code=202,
    )


@router.get("/{project_id}/assignment-requests")
async def list_assignment_requests(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await requests.list_requests(db, project_id=project_id, user=user)
    if rows is None:
        raise _request_error("not_found")
    names: dict[str, str] = {}
    if rows:
        for uid, full_name, company in (await db.execute(
            select(User.id, User.full_name, ContractorProfile.company_name)
            .outerjoin(ContractorProfile, ContractorProfile.user_id == User.id)
            .where(User.id.in_({r.contractor_id for r in rows}))
        )).all():
            names[uid] = company or full_name or "Исполнитель"
    return {"items": [
        {**_request_out(r), "contractor_name": names.get(r.contractor_id, "Исполнитель")}
        for r in rows
    ]}


async def _resolve(project_id: str, request_id: str, user: User, db: AsyncSession, accept: bool):
    if user.role != UserRole.customer:
        raise HTTPException(403, detail={"code": "customer_owner_only"})
    result = await requests.resolve_request(
        db, project_id=project_id, request_id=request_id, actor_id=user.id, accept=accept,
    )
    if result.status == "accepted" and result.project is not None:
        await db.refresh(user)  # a replayed decision ends in rollback, which expires the actor
        return {"status": "accepted", "request": _request_out(result.request),
                "project": await _detail(db, result.project, user)}
    if result.status == "declined":
        return {"status": "declined", "request": _request_out(result.request)}
    raise _request_error(result.status)


@router.post("/{project_id}/assignment-requests/{request_id}/accept")
async def accept_assignment_request(
    project_id: str, request_id: str,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    return await _resolve(project_id, request_id, user, db, True)


@router.post("/{project_id}/assignment-requests/{request_id}/decline")
async def decline_assignment_request(
    project_id: str, request_id: str,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    return await _resolve(project_id, request_id, user, db, False)


@router.delete("/{project_id}/contractor")
async def release_contractor(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.customer:
        raise HTTPException(403, detail={"code": "customer_owner_only"})
    result = await requests.release_contractor(db, project_id=project_id, actor_id=user.id)
    if result.status == "blocked":
        first = (result.blockers or [{}])[0]
        raise HTTPException(409, detail={
            "code": first.get("code", "contractor_release_blocked"),
            "message": " ".join(b["message"] for b in result.blockers or []),
            "blockers": result.blockers,
        })
    if result.status != "released" or result.project is None:
        raise _request_error(result.status)
    return await _detail(db, result.project, user)


@router.post("/{project_id}/contractor")
async def link_contractor(
    project_id: str,
    body: LinkContractorIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.customer:
        raise HTTPException(403, detail={"code": "customer_owner_only"})
    # The service validates current ownership, target and lifecycle under the
    # same project lock used for assignment, rather than trusting a stale read.
    result = await assignment.assign_contractor(
        db, project_id=project_id, contractor_id=body.contractor_id, actor_id=user.id,
    )
    if result.status != "assigned" or result.project is None:
        raise _assignment_error(result.status)
    return await _detail(db, result.project, user)
