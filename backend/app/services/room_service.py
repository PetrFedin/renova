"""Комнаты: габариты, розетки, сантехника → строки сметы."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import EstimateLine, LineType, Room
from app.services.calc.estimate import calc_room_metrics
from app.services.estimate_service import recalc_budget

OUTLET_WORK = 850
OUTLET_MAT = 200
PLUMBING_WORK = 3500
PLUMBING_MAT = 1200


async def update_room(db: AsyncSession, room_id: str, data: dict, user_id: str | None = None, threshold_pct: float = 10) -> Room | None:
    room = await db.get(Room, room_id)
    if not room:
        return None
    from app.models.entities import RoomChangeLog
    for k, v in data.items():
        if hasattr(room, k) and v is not None:
            old = getattr(room, k)
            if str(old) != str(v) and user_id:
                db.add(RoomChangeLog(room_id=room_id, user_id=user_id, field_name=k, old_value=str(old), new_value=str(v)))
            setattr(room, k, v)
    await db.commit()
    await sync_room_estimate_lines(db, room)
    await db.refresh(room)
    from app.models.entities import Project
    from app.services import notification_service as ns
    proj = await db.get(Project, room.project_id)
    from sqlalchemy import select
    from app.models.entities import EstimateLine
    lines = (await db.execute(select(EstimateLine).where(EstimateLine.room_id == room.id))).scalars().all()
    plan = sum(l.quantity_planned * l.unit_price for l in lines)
    fact = sum(l.quantity_actual * l.unit_price for l in lines)
    if proj and proj.customer_id:
        await ns.notify(db, user_id=proj.customer_id, project_id=proj.id, notification_type="room_updated", title="Обновлена комната", body=room.name, link_path=f"/room/{room.id}", return_to="/(customer)/(tabs)/object?tab=rooms")
    if proj and proj.customer_id and fact > plan and plan > 0:
        await ns.notify(db, user_id=proj.customer_id, project_id=proj.id, notification_type="change_order", title="Превышение бюджета комнаты", body=f"{room.name}: +{fact-plan:.0f} RUB", link_path=f"/room/{room.id}", return_to="/(customer)/(tabs)/object?tab=rooms")
    return room


async def sync_room_estimate_lines(db: AsyncSession, room: Room) -> None:
    """Пересчитывает строки электрики/сантехники по точкам комнаты."""
    result = await db.execute(
        select(EstimateLine).where(
            EstimateLine.room_id == room.id,
            EstimateLine.category.in_(["electrical", "plumbing"]),
        )
    )
    for line in result.scalars().all():
        await db.delete(line)

    if room.outlets_count > 0:
        qty = room.outlets_count
        db.add(
            EstimateLine(
                project_id=room.project_id,
                room_id=room.id,
                line_type=LineType.work,
                name="Монтаж розеток",
                unit="шт",
                quantity_planned=qty,
                unit_price=OUTLET_WORK,
                room_name=room.name,
                category="electrical",
                calc_detail=f"{qty} шт × {OUTLET_WORK} ₽/шт",
            )
        )
        db.add(
            EstimateLine(
                project_id=room.project_id,
                room_id=room.id,
                line_type=LineType.material,
                name="Розетки + подрозетники",
                unit="шт",
                quantity_planned=qty,
                unit_price=OUTLET_MAT,
                room_name=room.name,
                category="electrical",
                calc_detail=f"{qty} шт × {OUTLET_MAT} ₽/шт",
            )
        )

    if room.plumbing_points > 0:
        qty = room.plumbing_points
        db.add(
            EstimateLine(
                project_id=room.project_id,
                room_id=room.id,
                line_type=LineType.work,
                name="Разводка сантехники",
                unit="точка",
                quantity_planned=qty,
                unit_price=PLUMBING_WORK,
                room_name=room.name,
                category="plumbing",
                calc_detail=f"{qty} точек × {PLUMBING_WORK} ₽",
            )
        )
        db.add(
            EstimateLine(
                project_id=room.project_id,
                room_id=room.id,
                line_type=LineType.material,
                name="Материалы сантехники",
                unit="точка",
                quantity_planned=qty,
                unit_price=PLUMBING_MAT,
                room_name=room.name,
                category="plumbing",
                calc_detail=f"{qty} × {PLUMBING_MAT} ₽",
            )
        )

    await db.commit()
    await recalc_budget(db, room.project_id)


def room_detail(room: Room) -> dict:
    m = calc_room_metrics(room.length_m, room.width_m, room.height_m, room.openings_sq_m)
    return {
        "id": room.id,
        "name": room.name,
        "room_type": room.room_type,
        "floor_level": getattr(room, "floor_level", 1) or 1,
        "length_m": room.length_m,
        "width_m": room.width_m,
        "height_m": room.height_m,
        "openings_sq_m": room.openings_sq_m,
        "outlets_count": room.outlets_count,
        "switches_count": room.switches_count,
        "plumbing_points": room.plumbing_points,
        "notes": room.notes,
        "budget_alert_pct": getattr(room, "budget_alert_pct", None),
        "floor_sq_m": m.floor_sq_m,
        "wall_sq_m": m.wall_sq_m,
        "perimeter_m": m.perimeter_m,
        "is_archived": getattr(room, "is_archived", False),
    }


async def create_room(db: AsyncSession, project_id: str, data: dict, user_id: str | None = None) -> Room | None:
    """Добавляет комнату в существующий проект и пересчитывает смету."""
    from app.models.entities import EstimateLine, LineType, Project
    from app.services.calc.estimate import calc_room_metrics, effective_renovation_type, generate_lines

    project = await db.get(Project, project_id)
    if not project:
        return None

    room = Room(
        project_id=project_id,
        name=data["name"],
        room_type=data.get("room_type"),
        floor_level=data.get("floor_level", 1),
        length_m=data["length_m"],
        width_m=data["width_m"],
        height_m=data.get("height_m", 2.7),
        openings_sq_m=data.get("openings_sq_m", 2),
        outlets_count=data.get("outlets_count", 0),
        switches_count=data.get("switches_count", 0),
        plumbing_points=data.get("plumbing_points", 0),
        notes=data.get("notes"),
        budget_alert_pct=data.get("budget_alert_pct"),
    )
    db.add(room)
    await db.flush()

    m = calc_room_metrics(room.length_m, room.width_m, room.height_m, room.openings_sq_m)
    eff = effective_renovation_type(project.renovation_type, room.room_type)
    for cl in generate_lines(eff, room.id, room.name, m):
        db.add(
            EstimateLine(
                project_id=project_id,
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
    if room.outlets_count or room.plumbing_points:
        await sync_room_estimate_lines(db, room)
    await recalc_budget(db, project_id)
    await db.refresh(room)

    if user_id and project.customer_id:
        from app.services import notification_service as ns
        await ns.notify(
            db,
            user_id=project.customer_id,
            project_id=project_id,
            notification_type="room_created",
            title="Новая комната",
            body=room.name,
            link_path=f"/room/{room.id}",
            return_to="/(customer)/(tabs)/",
        )
    return room
