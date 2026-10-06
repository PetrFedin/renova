from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User, FloorPlan, FloorPlanPin, FurnitureItem, ProjectIssue
from app.services import floor_plan_service as fp_svc
from app.services.client_write_idempotency import IdempotencyConflict

router = APIRouter(prefix="/projects", tags=["floor-plans"])

def _idempotency_http_error() -> HTTPException:
    return HTTPException(
        409,
        detail={"code": "idempotency_conflict", "message": "Повтор запроса с другими данными."},
    )

class PlanIn(BaseModel):
    name: str = "Планировка"
    floor_level: int = 1
    image_key: str
    width_px: int | None = None
    height_px: int | None = None
    # #442/#475: same key + exact serialized body on first send and every
    # offline-queue replay so a lost response can never mint a second plan.
    client_request_id: str | None = Field(default=None, max_length=80)

class PinPatch(BaseModel):
    x_pct: float
    y_pct: float

class PinIn(BaseModel):
    room_id: str
    x_pct: float = 50
    y_pct: float = 50
    label: str | None = None
    # #475: replay-safe upsert — same key/payload can't duplicate evidence.
    client_request_id: str | None = Field(default=None, max_length=80)

class FurnitureIn(BaseModel):
    room_id: str | None = None
    floor_plan_id: str | None = None
    name: str
    width_m: float = 0.6
    depth_m: float = 0.6
    height_m: float = 0.8
    x_pct: float | None = None
    y_pct: float | None = None
    notes: str | None = None
    # #442/#468: same key + exact serialized body on first send and every
    # offline-queue replay so a lost response can never mint a second item.
    client_request_id: str | None = Field(default=None, max_length=80)

def _punch_item(i: ProjectIssue) -> dict:
    return {
        "id": i.id,
        "title": i.title,
        "severity": i.severity,
        "status": i.status,
        "x_pct": i.x_pct,
        "y_pct": i.y_pct,
        "photo_key": i.photo_key,
        "photo_url": f"/api/v1/media/{i.photo_key}" if i.photo_key else None,
    }


def _plan(p: FloorPlan, pins: list, punch: list | None = None) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "image_key": p.image_key,
        "image_url": f"/api/v1/media/{p.image_key}",
        "width_px": p.width_px,
        "height_px": p.height_px,
        "floor_level": getattr(p, "floor_level", 1),
        "pins": pins,
        "punch": punch or [],
        "created_at": p.created_at.isoformat(),
    }

@router.get("/{project_id}/floor-plans")
async def list_plans(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    r = await db.execute(select(FloorPlan).where(FloorPlan.project_id == project_id).order_by(FloorPlan.created_at.desc()))
    out = []
    for p in r.scalars().all():
        pr = await db.execute(select(FloorPlanPin).where(FloorPlanPin.floor_plan_id == p.id))
        pins = [{"id": x.id, "room_id": x.room_id, "x_pct": x.x_pct, "y_pct": x.y_pct, "label": x.label} for x in pr.scalars().all()]
        ir = await db.execute(
            select(ProjectIssue).where(
                ProjectIssue.floor_plan_id == p.id,
                ProjectIssue.x_pct.isnot(None),
                ProjectIssue.y_pct.isnot(None),
            ).order_by(ProjectIssue.created_at.desc())
        )
        punch = [_punch_item(i) for i in ir.scalars().all()]
        out.append(_plan(p, pins, punch))
    return out

@router.post("/{project_id}/floor-plans")
async def create_plan(project_id: str, body: PlanIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    try:
        plan, replayed = await fp_svc.create_or_replay_floor_plan(
            db,
            project=project,
            actor_id=user.id,
            name=body.name,
            floor_level=body.floor_level,
            image_key=body.image_key,
            width_px=body.width_px,
            height_px=body.height_px,
            client_request_id=body.client_request_id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    result = _plan(plan, [], [])
    result["replayed"] = replayed
    return result

@router.post("/{project_id}/floor-plans/{plan_id}/pins")
async def upsert_pin(project_id: str, plan_id: str, body: PinIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    try:
        pin, replayed = await fp_svc.upsert_or_replay_pin(
            db,
            project=project,
            actor_id=user.id,
            plan_id=plan_id,
            room_id=body.room_id,
            x_pct=body.x_pct,
            y_pct=body.y_pct,
            label=body.label,
            client_request_id=body.client_request_id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    except ValueError as exc:
        code = str(exc)
        if code in ("floor_plan_not_found", "floor_plan_pin_idempotency_target_missing"):
            raise HTTPException(404, detail=code) from exc
        if code == "floor_plan_pin_room_invalid":
            raise HTTPException(400, "room not in project") from exc
        if code == "floor_plan_project_authority_stale":
            raise HTTPException(403, detail=code) from exc
        raise
    return {"id": pin.id, "room_id": pin.room_id, "x_pct": pin.x_pct, "y_pct": pin.y_pct, "label": pin.label, "replayed": replayed}

@router.get("/{project_id}/furniture")
async def list_furniture(project_id: str, room_id: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=False)
    q = select(FurnitureItem).where(FurnitureItem.project_id == project_id)
    if room_id: q = q.where(FurnitureItem.room_id == room_id)
    r = await db.execute(q.order_by(FurnitureItem.created_at.desc()))
    return [{"id": f.id, "room_id": f.room_id, "floor_plan_id": f.floor_plan_id, "name": f.name, "width_m": f.width_m, "depth_m": f.depth_m, "height_m": f.height_m, "x_pct": f.x_pct, "y_pct": f.y_pct, "notes": f.notes} for f in r.scalars().all()]

@router.post("/{project_id}/furniture")
async def create_furniture(project_id: str, body: FurnitureIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    project = await require_project(db, project_id, user, write=True)
    try:
        f, replayed = await fp_svc.create_or_replay_furniture(
            db,
            project=project,
            actor_id=user.id,
            room_id=body.room_id,
            floor_plan_id=body.floor_plan_id,
            name=body.name,
            width_m=body.width_m,
            depth_m=body.depth_m,
            height_m=body.height_m,
            x_pct=body.x_pct,
            y_pct=body.y_pct,
            notes=body.notes,
            client_request_id=body.client_request_id,
        )
    except IdempotencyConflict as exc:
        raise _idempotency_http_error() from exc
    except ValueError as exc:
        code = str(exc)
        if code in ("furniture_room_not_found", "furniture_floor_plan_not_found", "furniture_idempotency_target_missing"):
            raise HTTPException(404, detail=code) from exc
        raise
    return {"id": f.id, "name": f.name, "width_m": f.width_m, "depth_m": f.depth_m, "height_m": f.height_m, "x_pct": f.x_pct, "y_pct": f.y_pct, "replayed": replayed}

@router.delete("/{project_id}/floor-plans/{plan_id}")
async def delete_floor_plan(project_id: str, plan_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Удалить план этажа.

    Пины уходят вместе с планом: пин — это точка **на плане**, без него он
    ничего не значит.

    Мебель не удаляется, а открепляется. Предмет мебели принадлежит объекту и
    комнате; на плане он лишь размещён. Удалять его вместе с планом значило бы
    стирать данные, которые человек вводил отдельно.
    """
    await require_project(db, project_id, user, write=True)
    plan = await db.get(FloorPlan, plan_id)
    if not plan or plan.project_id != project_id:
        raise HTTPException(404, "План не найден")

    pins = list(
        (await db.execute(select(FloorPlanPin).where(FloorPlanPin.floor_plan_id == plan_id)))
        .scalars()
        .all()
    )
    for pin in pins:
        await db.delete(pin)

    placed = list(
        (
            await db.execute(
                select(FurnitureItem).where(
                    FurnitureItem.project_id == project_id,
                    FurnitureItem.floor_plan_id == plan_id,
                )
            )
        )
        .scalars()
        .all()
    )
    for item in placed:
        item.floor_plan_id = None
        item.x_pct = None
        item.y_pct = None

    await db.delete(plan)
    await db.commit()
    return {"ok": True, "id": plan_id, "pins_removed": len(pins), "furniture_detached": len(placed)}


@router.delete("/{project_id}/floor-plans/{plan_id}/pins/{pin_id}")
async def delete_pin(project_id: str, plan_id: str, pin_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Снять пин с плана."""
    await require_project(db, project_id, user, write=True)
    plan = await db.get(FloorPlan, plan_id)
    if not plan or plan.project_id != project_id:
        raise HTTPException(404, "План не найден")
    pin = await db.get(FloorPlanPin, pin_id)
    # Пин сверяется и с планом из пути: без этого снять можно было бы чужой,
    # зная идентификатор.
    if not pin or pin.floor_plan_id != plan_id:
        raise HTTPException(404, "Пин не найден")
    await db.delete(pin)
    await db.commit()
    return {"ok": True, "id": pin_id}


@router.delete("/{project_id}/furniture/{item_id}")
async def delete_furniture(project_id: str, item_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Удалить предмет мебели."""
    await require_project(db, project_id, user, write=True)
    item = await db.get(FurnitureItem, item_id)
    if not item or item.project_id != project_id:
        raise HTTPException(404, "Предмет не найден")
    await db.delete(item)
    await db.commit()
    return {"ok": True, "id": item_id}


@router.patch("/{project_id}/floor-plans/{plan_id}/pins/{pin_id}")
async def move_pin(project_id: str, plan_id: str, pin_id: str, body: PinPatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    # #377: resolve the FloorPlan against the path project first, then the
    # pin against (pin_id, floor_plan_id=plan_id) in one query — a pin that
    # exists but belongs to a different plan/project must 404 exactly like a
    # pin that does not exist at all (no cross-project existence leak).
    plan = await db.get(FloorPlan, plan_id)
    if not plan or plan.project_id != project_id:
        raise HTTPException(404)
    r = await db.execute(
        select(FloorPlanPin).where(FloorPlanPin.id == pin_id, FloorPlanPin.floor_plan_id == plan_id)
    )
    pin = r.scalar_one_or_none()
    if not pin: raise HTTPException(404)
    pin.x_pct, pin.y_pct = body.x_pct, body.y_pct
    await db.commit()
    return {"id": pin.id, "x_pct": pin.x_pct, "y_pct": pin.y_pct}

class FurnitureMove(BaseModel):
    x_pct: float
    y_pct: float

@router.patch("/{project_id}/furniture/{item_id}")
async def move_furniture(project_id: str, item_id: str, body: FurnitureMove, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_project(db, project_id, user, write=True)
    f = await db.get(FurnitureItem, item_id)
    if not f or f.project_id != project_id: raise HTTPException(404)
    f.x_pct, f.y_pct = body.x_pct, body.y_pct
    await db.commit()
    return {"ok": True, "x_pct": f.x_pct, "y_pct": f.y_pct}
