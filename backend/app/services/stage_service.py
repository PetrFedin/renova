from app.core.timeutil import utc_now
import json
from datetime import date, datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.models.entities import Stage, StageComment, StagePhoto, StageStatus
from app.services import storage_service as storage_svc
from app.services import notification_service as notif_svc


def parse_room_ids(stage: Stage) -> list[str]:
    raw = getattr(stage, "room_ids_json", None)
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return [x for x in data if isinstance(x, str)]
    except Exception:
        return []


def set_room_ids(stage: Stage, room_ids: list[str]) -> None:
    stage.room_ids_json = json.dumps(room_ids) if room_ids else None


from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.models.entities import Stage, StageComment, StagePhoto, StageStatus
from app.services import storage_service as storage_svc
from app.services import notification_service as notif_svc


async def get_stage_full(db: AsyncSession, stage_id: str) -> Stage | None:
    result = await db.execute(
        select(Stage)
        .where(Stage.id == stage_id)
        .options(selectinload(Stage.comments), selectinload(Stage.photos))
    )
    return result.scalar_one_or_none()


async def add_comment(db: AsyncSession, stage_id: str, user_id: str, role: str, text: str) -> StageComment:
    c = StageComment(stage_id=stage_id, user_id=user_id, author_role=role, text=text)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


async def add_photo(db: AsyncSession, stage_id: str, user_id: str, image_data: str | None, caption: str | None, *, storage_key: str | None = None, image_url: str | None = None) -> StagePhoto:
    if storage_key and image_url:
        key, url = storage_key, image_url
    elif image_data and (image_data.startswith('http') or '/media/' in image_data):
        key = image_data.split('/media/')[-1] if '/media/' in image_data else image_data.rsplit('/', 1)[-1]
        url = image_data if image_data.startswith('http') else f"{storage_svc.settings.public_base_url if False else ''}"
        from app.core.config import settings
        url = image_data if image_data.startswith('http') else f"{settings.public_base_url}/api/v1/media/{key}"
        key = key if '/' in key else f"photos/{key}"
    else:
        key, url = await storage_svc.save_image(image_data or '', folder="stages")
    p = StagePhoto(stage_id=stage_id, user_id=user_id, caption=caption, storage_key=key, image_url=url)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


async def set_contractor_ready(db: AsyncSession, stage_id: str, *, skip_gate: bool = False) -> tuple[Stage | None, dict | None]:
    """Отметить готовность этапа. Возвращает (stage, error) — error с completion checks при блокировке gate."""
    stage = await get_stage_full(db, stage_id)
    if not stage:
        return None, None
    from app.models.entities import Project
    from app.services import workflow_service as wf
    from app.services import work_snapshot_service as ws
    proj = await db.get(Project, stage.project_id)
    await wf.ensure_stage_checklist(db, stage)
    cl = wf.stage_checklist(stage)
    prog = wf.checklist_progress(cl)
    stage.percent_complete = float(prog)
    if not skip_gate:
        comp = await ws.completion_check(db, stage, proj)
        if not comp.get("ok"):
            await db.commit()
            return None, {"code": "completion_gate", "completion": comp}
    stage.contractor_ready = True
    stage.contractor_ready_at = utc_now()
    stage.percent_complete = float(prog)
    stage.status = StageStatus.review
    if not getattr(stage, "actual_end", None):
        stage.actual_end = date.today()
    stage.needs_rework = False
    stage.rework_deadline = None
    await db.commit()
    await db.refresh(stage)
    from sqlalchemy import select
    from app.models.entities import Project
    proj = await db.get(Project, stage.project_id)
    if proj and proj.customer_id:
        await notif_svc.notify(db, user_id=proj.customer_id, project_id=proj.id, notification_type="stage_review", title="Этап на приёмке", body=stage.name, link_path=f"/stage/{stage.id}", return_to="/(customer)/(tabs)/repair?tab=control")
    from app.services import acceptance_service as acc_svc
    from app.services.stage_service import parse_room_ids
    room_ids = parse_room_ids(stage)
    room_id = room_ids[0] if room_ids else None
    await acc_svc.request_acceptance(db, stage, room_id=room_id)
    from app.services import activity_service as act
    await act.log_event(db, project_id=stage.project_id, user_id=None, kind="WorkCompleted", title=f"Завершено: {stage.name}", link_path=f"/stage/{stage.id}", stage_id=stage.id)
    await act.log_event(db, project_id=stage.project_id, user_id=None, kind="InspectionRequested", title=f"Запрошена приёмка: {stage.name}", link_path=f"/(customer)/(tabs)/repair?tab=control", stage_id=stage.id)
    return stage, None




async def start_stage(db: AsyncSession, stage_id: str) -> tuple[Stage | None, dict | None]:
    """§4.11 — начать этап: planned → active, фиксируем actual_start."""
    stage = await get_stage_full(db, stage_id)
    if not stage:
        return None, {"code": "not_found"}
    if stage.status != StageStatus.planned:
        return None, {"code": "invalid_status", "message": "Этап уже начат или завершён"}
    from app.services import dependency_service as dep_svc
    from app.services import project_document_service as docs_svc
    gate = await docs_svc.project_contract_gate(db, stage.project_id)
    if not gate.get("ok"):
        from app.models.entities import Project
        proj = await db.get(Project, stage.project_id)
        if proj and proj.customer_id:
            await notif_svc.notify(
                db,
                user_id=proj.customer_id,
                project_id=proj.id,
                notification_type="document",
                title="Нужна подпись договора",
                body=gate.get("message") or "Исполнитель не может начать этап без подписанного договора",
                link_path="/documents",
                return_to="/(customer)/(tabs)/repair?tab=control",
            )
            await db.commit()
        return None, {"code": gate.get("code", "contract_not_signed"), "message": gate.get("message"), "pending_titles": gate.get("pending_titles", [])}
    blocked = await dep_svc.evaluate_stage(db, stage)
    if blocked.get("blocked"):
        return None, {"code": "blocked", "reasons": blocked.get("reasons", [])}
    stage.status = StageStatus.active
    if not getattr(stage, "actual_start", None):
        stage.actual_start = date.today()
    if not getattr(stage, "ical_uid", None):
        stage.ical_uid = f"renova-{stage.id}@app"
    from app.models.entities import Project
    proj = await db.get(Project, stage.project_id)
    if proj and proj.contractor_id:
        await notif_svc.notify(
            db, user_id=proj.contractor_id, project_id=proj.id,
            notification_type="stage_start", title=f"Начат этап: {stage.name}",
            body="Приступайте к работам", link_path=f"/stage/{stage.id}",
            return_to="/(contractor)/(tabs)/repair?tab=works",
        )
    await db.commit()
    await db.refresh(stage)
    from app.services import activity_service as act
    await act.log_event(db, project_id=stage.project_id, user_id=None, kind="StageStarted", title=f"Начат: {stage.name}", link_path=f"/stage/{stage.id}", stage_id=stage.id)
    return stage, None

async def update_stage_dates(db: AsyncSession, stage_id: str, start: date | None, end: date | None) -> Stage | None:
    stage = await db.get(Stage, stage_id)
    if not stage:
        return None
    if start:
        stage.planned_start = start
    if end:
        stage.planned_end = end
    if not getattr(stage, 'ical_uid', None):
        stage.ical_uid = f'renova-{stage.id}@app'
    await db.commit()
    await db.refresh(stage)
    return stage


def stage_to_dict(stage: Stage) -> dict:
    from app.services import workflow_service as wf
    cl = wf.stage_checklist(stage)
    return {
        "id": stage.id,
        "name": stage.name,
        "sort_order": stage.sort_order,
        "status": stage.status.value,
        "percent_complete": stage.percent_complete,
        "payment_amount": stage.payment_amount,
        "weight_coefficient": getattr(stage, "weight_coefficient", 0) or 0,
        "notes": stage.notes,
        "planned_start": stage.planned_start.isoformat() if stage.planned_start else None,
        "planned_end": stage.planned_end.isoformat() if stage.planned_end else None,
        "contractor_ready": stage.contractor_ready,
        "contractor_ready_at": stage.contractor_ready_at.isoformat() if stage.contractor_ready_at else None,
        "customer_accepted_at": stage.customer_accepted_at.isoformat() if stage.customer_accepted_at else None,
        "needs_rework": getattr(stage, "needs_rework", False),
        "ical_uid": getattr(stage, "ical_uid", None),
        "rework_deadline": stage.rework_deadline.isoformat() if getattr(stage, "rework_deadline", None) else None,
        "work_type": getattr(stage, "work_type", None),
        "assignee_id": getattr(stage, "assignee_id", None),
        "actual_start": stage.actual_start.isoformat() if getattr(stage, "actual_start", None) else None,
        "actual_end": stage.actual_end.isoformat() if getattr(stage, "actual_end", None) else None,
        "checklist_progress": wf.checklist_progress(cl),
        "room_ids": parse_room_ids(stage),
        "comments": [
            {"id": c.id, "text": c.text, "author_role": c.author_role, "created_at": c.created_at.isoformat()}
            for c in sorted(getattr(stage, "comments", None) or [], key=lambda x: x.created_at)
        ],
        "photos": [
            {"id": p.id, "caption": p.caption, "created_at": p.created_at.isoformat(), "image_url": p.image_url, "has_image": bool(p.image_url or p.image_data)}
            for p in sorted(getattr(stage, "photos", None) or [], key=lambda x: x.created_at)
        ],
    }


async def set_stage_rooms(db: AsyncSession, stage_id: str, room_ids: list[str]) -> Stage | None:
    stage = await db.get(Stage, stage_id)
    if not stage:
        return None
    set_room_ids(stage, room_ids)
    await db.commit()
    await db.refresh(stage)
    return await get_stage_full(db, stage_id)

async def create_stage(
    db: AsyncSession,
    project_id: str,
    *,
    name: str,
    planned_start: date | None = None,
    planned_end: date | None = None,
    room_ids: list[str] | None = None,
    work_type: str | None = None,
) -> Stage | None:
    """Добавить этап в существующий проект (после wizard)."""
    from sqlalchemy import select
    from app.models.entities import Project

    p = await db.get(Project, project_id)
    if not p:
        return None
    stages = list((await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all())
    sort_order = max((s.sort_order for s in stages), default=-1) + 1
    stage = Stage(
        project_id=project_id,
        name=name.strip(),
        sort_order=sort_order,
        status=StageStatus.planned,
        percent_complete=0,
        payment_amount=0,
        weight_coefficient=0,
        planned_start=planned_start,
        planned_end=planned_end,
        work_type=work_type,
    )
    if room_ids:
        set_room_ids(stage, room_ids)
    db.add(stage)
    await db.commit()
    await db.refresh(stage)
    return stage
