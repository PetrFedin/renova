"""Бизнес-логика проектов: создание, dashboard, приёмка этапов."""
from datetime import date, datetime, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.entities import EstimateLine, LineType, Payment, PaymentStatus, PaymentType, Project, Room, Stage, StageStatus, User
from app.services.estimate_service import material_stats
from app.services.calc.estimate import DEFAULT_STAGES, calc_room_metrics, stages_for_renovation, generate_lines, summary_total, effective_renovation_type
from app.services import stage_status_service as st_status
from app.services import room_service as room_svc
from app.services import notification_service as notif_svc
from app.services import payment_service as pay_svc
from app.core.config import settings
from app.services.subscription_service import is_pro
from app.services import team_service as team_svc


STAGE_ROOM_TYPES: dict[str, list[str]] = {
    "сантех": ["bathroom", "toilet", "kitchen"],
    "гидро": ["bathroom", "toilet"],
    "плитк": ["bathroom", "toilet", "kitchen"],
    "фартук": ["kitchen"],
    "соглас": [],
    "электр": [],
    "демонтаж": [],
    "чернов": [],
    "чистов": [],
    "приём": [],
}


def _suggest_room_ids(stage_name: str, rooms: list) -> list[str]:
    low = stage_name.lower()
    for key, types in STAGE_ROOM_TYPES.items():
        if key in low and types:
            return [r.id for r in rooms if getattr(r, "room_type", None) in types]
    return []


def _apply_stage_room_defaults(stages: list, rooms: list) -> None:
    import json
    for st in stages:
        ids = _suggest_room_ids(st.name, rooms)
        if ids:
            st.room_ids_json = json.dumps(ids)


async def create_project(
    db: AsyncSession,
    *,
    customer_id: str,
    name: str,
    address: str | None,
    renovation_type: str,
    rooms_data: list[dict],
    contractor_id: str | None = None,
    property_type: str = "apartment",
    total_area_sqm: float | None = None,
    planned_start_date: date | None = None,
    planned_end_date: date | None = None,
) -> Project:
    start = planned_start_date or date.today()
    project = Project(
        name=name,
        address=address,
        renovation_type=renovation_type,
        property_type=property_type,
        total_area_sqm=total_area_sqm,
        customer_id=customer_id,
        contractor_id=contractor_id,
        planned_start_date=start,
        planned_end_date=planned_end_date or (start + timedelta(days=60)),
    )
    db.add(project)
    await db.flush()

    all_lines = []
    for rd in rooms_data:
        room = Room(
            project_id=project.id,
            name=rd["name"],
            room_type=rd.get("room_type"),
            floor_level=rd.get("floor_level", 1),
            length_m=rd["length_m"],
            width_m=rd["width_m"],
            height_m=rd.get("height_m", 2.7),
            openings_sq_m=rd.get("openings_sq_m", 2),
            outlets_count=rd.get("outlets_count", 0),
            switches_count=rd.get("switches_count", 0),
            plumbing_points=rd.get("plumbing_points", 0),
            notes=rd.get("notes"),
        )
        db.add(room)
        await db.flush()
        m = calc_room_metrics(room.length_m, room.width_m, room.height_m, room.openings_sq_m)
        eff = effective_renovation_type(renovation_type, room.room_type)
        for cl in generate_lines(eff, room.id, room.name, m):
            all_lines.append(cl)

    for cl in all_lines:
        db.add(
            EstimateLine(
                project_id=project.id,
                room_id=cl.room_id,
                line_type=LineType(cl.line_type),
                name=cl.name,
                unit=cl.unit,
                quantity_planned=cl.quantity,
                unit_price=cl.unit_price,
                room_name=cl.room_name,
                category="finish",
            )
        )

    await db.commit()
    for rd in rooms_data:
        pass

    p = await get_project(db, project.id)
    if p:
        for room in p.rooms:
            if room.outlets_count or room.plumbing_points:
                await room_svc.sync_room_estimate_lines(db, room)

    p = await get_project(db, project.id)
    if not p:
        return project

    total = sum(l.quantity_planned * l.unit_price for l in p.estimate_lines)
    p.budget_planned = _r2(total)

    day_cursor = start
    total_days = 60
    for i, (stage_name, weight) in enumerate(stages_for_renovation(renovation_type)):
        stage_days = max(3, int(total_days * weight))
        stage_end = day_cursor + timedelta(days=stage_days - 1)
        db.add(
            Stage(
                project_id=p.id,
                name=stage_name,
                sort_order=i,
                status=StageStatus.active if i == 0 else StageStatus.planned,
                percent_complete=0,
                payment_amount=_r2(total * weight),
                weight_coefficient=weight,
                planned_start=day_cursor,
                planned_end=stage_end,
            )
        )
        day_cursor = stage_end + timedelta(days=1)

    await db.flush()
    st_result = await db.execute(select(Stage).where(Stage.project_id == p.id))
    stage_rows = list(st_result.scalars().all())
    _apply_stage_room_defaults(stage_rows, list(p.rooms))
    await db.commit()
    return await get_project(db, p.id)


def _r2(n: float) -> float:
    return round(n, 2)


async def get_project(db: AsyncSession, project_id: str) -> Project | None:
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .options(
            selectinload(Project.rooms),
            selectinload(Project.estimate_lines),
            selectinload(Project.stages).selectinload(Stage.comments),
            selectinload(Project.stages).selectinload(Stage.photos),
            selectinload(Project.change_orders),
            selectinload(Project.receipts),
            selectinload(Project.payments),
            selectinload(Project.work_orders),
        )
    )
    return result.scalar_one_or_none()


async def list_projects_for_user(db: AsyncSession, user: User, bucket: str = "active") -> list[Project]:
    return await list_projects_for_user_bucket(db, user, bucket)



def build_dashboard(project: Project) -> dict:
    stages = sorted(project.stages, key=lambda s: s.sort_order)
    progress = st_status.weighted_progress(stages)
    review = next((s for s in stages if s.status == StageStatus.review), None)
    active = next((s for s in stages if s.status == StageStatus.active), None)
    next_stage = review or active

    ms = material_stats(project.estimate_lines)
    overrun = ms["overrun_percent"]

    alerts = []
    if overrun > 5:
        alerts.append(f"Перерасход материалов {round(overrun)}%")
    days_overdue = 0
    if project.planned_end_date and date.today() > project.planned_end_date and progress < 100:
        days_overdue = (date.today() - project.planned_end_date).days
        alerts.append(f"Просрочка {days_overdue} дн.")

    pending_payments = getattr(project, "payments", []) or []
    pending_count = sum(1 for p in pending_payments if p.status == PaymentStatus.pending)
    if pending_count:
        alerts.append(f"Ожидает подтверждения оплат: {pending_count}")

    return {
        "project_id": project.id,
        "name": project.name,
        "progress_percent": round(progress, 1),
        "budget_planned": project.budget_planned,
        "budget_spent": project.budget_spent,
        "budget_variance_percent": round(
            ((project.budget_spent - project.budget_planned) / project.budget_planned * 100) if project.budget_planned else 0,
            1,
        ),
        "days_overdue": days_overdue,
        "next_action_title": f"{'Приёмка' if review else 'В работе'}: {next_stage.name}" if next_stage else "Проект завершён",
        "next_action_type": "accept_stage" if review else "review_estimate",
        "alerts": alerts,
        "planned_start_date": project.planned_start_date.isoformat() if project.planned_start_date else None,
        "planned_end_date": project.planned_end_date.isoformat() if project.planned_end_date else None,
    }


async def submit_stage_for_review(db: AsyncSession, stage_id: str) -> tuple[Stage | None, dict | None]:
    from app.services import stage_service as stage_svc
    return await stage_svc.set_contractor_ready(db, stage_id)


async def reject_stage(db: AsyncSession, stage_id: str, user_id: str, reason: str | None = None) -> Stage | None:
    result = await db.execute(select(Stage).where(Stage.id == stage_id))
    stage = result.scalar_one_or_none()
    if not stage or stage.status != StageStatus.review:
        return None
    stage.status = StageStatus.active
    stage.contractor_ready = False
    stage.contractor_ready_at = None
    stage.needs_rework = True
    stage.rework_deadline = datetime.utcnow() + timedelta(days=3)
    if reason:
        from app.models.entities import StageComment
        db.add(StageComment(stage_id=stage_id, user_id=user_id, author_role='customer', text=f'Отклонено: {reason}'))
        db.add(StageComment(stage_id=stage_id, user_id=user_id, author_role='contractor', text=f'📋 Задача: доработать — {reason or "см. комментарий"}'))
    await db.commit()
    await db.refresh(stage)
    project = await get_project(db, stage.project_id)
    if project and project.contractor_id:
        await notif_svc.notify(db, user_id=project.contractor_id, project_id=project.id, notification_type='stage_review', title='Этап отклонён · SLA 3д', body=f'{stage.name} до {(stage.rework_deadline or datetime.utcnow()).date()}', link_path=f'/stage/{stage.id}', return_to='/(contractor)/(tabs)/plan')
    return stage


async def accept_stage(db: AsyncSession, stage_id: str) -> Stage | None:
    result = await db.execute(select(Stage).where(Stage.id == stage_id))
    stage = result.scalar_one_or_none()
    if not stage or stage.status != StageStatus.review:
        return None
    stage.status = StageStatus.done
    stage.needs_rework = False
    stage.customer_accepted_at = datetime.utcnow()
    if not getattr(stage, "actual_end", None):
        stage.actual_end = date.today()

    project = await get_project(db, stage.project_id)
    if project:
        existing = next(
            (p for p in project.payments if p.stage_id == stage.id and p.payment_type == PaymentType.stage),
            None,
        )
        if project.customer_id:
            await notif_svc.notify(db, user_id=project.customer_id, project_id=project.id, notification_type="payment_pending", title="Подтвердите оплату этапа", body=stage.name, link_path="/(customer)/(tabs)/finance", return_to="/(customer)/(tabs)")
        if not existing and stage.payment_amount > 0:
            await pay_svc.create_payment(
                db,
                project.id,
                project.customer_id,
                f"Оплата этапа: {stage.name}",
                stage.payment_amount,
                "stage",
                stage.id,
                notes="Создано при приёмке этапа",
            )
        nxt = next(
            (s for s in sorted(project.stages, key=lambda x: x.sort_order) if s.sort_order > stage.sort_order and s.status == StageStatus.planned),
            None,
        )
        if nxt:
            nxt.status = StageStatus.active
            if not getattr(nxt, "actual_start", None):
                nxt.actual_start = date.today()
    from app.services import acceptance_service as acc_svc
    acc = await acc_svc.get_by_stage(db, stage.id)
    if acc and acc.status in ("requested", "in_review", "returned"):
        from app.services import issue_service as iss
        issues = await iss.list_issues(db, stage.project_id, status=None)
        open_n = len([i for i in issues if i.stage_id == stage.id and i.status != "closed"])
        await acc_svc.accept(db, acc.id, accepted_by=project.customer_id or "", open_issues=open_n)
    await db.commit()
    await db.refresh(stage)
    from app.services import activity_service as act
    await act.log_event(db, project_id=stage.project_id, user_id=None, kind="AcceptancePassed", title=f"Принято: {stage.name}", link_path=f"/stage/{stage.id}", stage_id=stage.id)
    await act.log_event(db, project_id=stage.project_id, user_id=None, kind="StageClosed", title=f"Этап закрыт: {stage.name}", link_path=f"/stage/{stage.id}", stage_id=stage.id)
    return stage


async def count_contractor_projects(db: AsyncSession, contractor_id: str) -> int:
    from sqlalchemy import func
    r = await db.execute(select(func.count()).select_from(Project).where(Project.contractor_id == contractor_id))
    return r.scalar() or 0


async def assign_contractor(db: AsyncSession, project_id: str, contractor_id: str) -> Project | None:
    p = await get_project(db, project_id)
    if not p:
        return None
    if p.contractor_id and p.contractor_id != contractor_id:
        return None
    cnt = await count_contractor_projects(db, contractor_id)
    if cnt >= settings.contractor_free_project_limit and p.contractor_id != contractor_id:
        if not await is_pro(db, contractor_id):
            return None
    p.contractor_id = contractor_id
    await db.commit()
    return await get_project(db, project_id)


async def update_project(db: AsyncSession, project_id: str, **fields) -> Project | None:
    p = await get_project(db, project_id)
    if not p:
        return None
    allowed = {"name", "address", "renovation_type", "property_type", "planned_start_date", "planned_end_date"}
    for key, val in fields.items():
        if key in allowed:
            setattr(p, key, val)
    await db.commit()
    await db.refresh(p)
    return p


async def _assert_customer_owner(db: AsyncSession, project_id: str, user: User) -> Project:
    p = await get_project(db, project_id)
    if not p:
        raise ValueError("not_found")
    if user.role.value != "customer" or p.customer_id != user.id:
        raise ValueError("forbidden")
    return p


def _bucket_filter(bucket: str):
    from sqlalchemy import and_
    if bucket == "archived":
        return and_(Project.trashed_at.is_(None), Project.is_archived.is_(True))
    if bucket == "trashed":
        return Project.trashed_at.isnot(None)
    return and_(Project.trashed_at.is_(None), Project.is_archived.is_(False))


async def list_projects_for_user_bucket(db: AsyncSession, user: User, bucket: str = "active") -> list[Project]:
    q = select(Project).options(
        selectinload(Project.stages),
        selectinload(Project.rooms),
        selectinload(Project.change_orders),
        selectinload(Project.receipts),
        selectinload(Project.payments),
    ).where(_bucket_filter(bucket))
    from app.models.entities import ProjectViewer
    if user.role.value == "customer":
        q = q.where(Project.customer_id == user.id)
        result = await db.execute(q.order_by(Project.created_at.desc()))
        owned = list(result.scalars().all())
        if bucket != "active":
            return owned
        gq = select(Project).options(
            selectinload(Project.stages), selectinload(Project.rooms),
            selectinload(Project.change_orders), selectinload(Project.receipts),
            selectinload(Project.payments),
        ).join(ProjectViewer, ProjectViewer.project_id == Project.id).where(
            ProjectViewer.user_id == user.id, _bucket_filter("active")
        )
        guest = list((await db.execute(gq.order_by(Project.created_at.desc()))).scalars().all())
        seen = {p.id for p in owned}
        for p in guest:
            if p.id not in seen:
                owned.append(p)
        return owned
    owners = await team_svc.team_owner_ids(db, user.id)
    contractor_ids = {user.id} | owners
    q = q.where(Project.contractor_id.in_(contractor_ids))
    result = await db.execute(q.order_by(Project.created_at.desc()))
    return list(result.scalars().all())


async def archive_project(db: AsyncSession, project_id: str, user: User) -> Project:
    p = await _assert_customer_owner(db, project_id, user)
    if p.trashed_at:
        raise ValueError("trashed")
    p.is_archived = True
    await db.commit()
    await db.refresh(p)
    return p


async def unarchive_project(db: AsyncSession, project_id: str, user: User) -> Project:
    p = await _assert_customer_owner(db, project_id, user)
    p.is_archived = False
    await db.commit()
    await db.refresh(p)
    return p


async def trash_project(db: AsyncSession, project_id: str, user: User) -> Project:
    from datetime import datetime
    p = await _assert_customer_owner(db, project_id, user)
    p.trashed_at = datetime.utcnow()
    p.is_archived = False
    await db.commit()
    await db.refresh(p)
    return p


async def restore_project(db: AsyncSession, project_id: str, user: User) -> Project:
    p = await _assert_customer_owner(db, project_id, user)
    p.trashed_at = None
    await db.commit()
    await db.refresh(p)
    return p


async def purge_project(db: AsyncSession, project_id: str, user: User) -> None:
    p = await _assert_customer_owner(db, project_id, user)
    if not p.trashed_at:
        raise ValueError("not_trashed")
    await db.delete(p)
    await db.commit()


async def empty_trash(db: AsyncSession, user: User) -> int:
    if user.role.value != "customer":
        return 0
    from sqlalchemy import delete
    r = await db.execute(
        delete(Project).where(Project.customer_id == user.id, Project.trashed_at.isnot(None))
    )
    await db.commit()
    return r.rowcount or 0
