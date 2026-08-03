"""Комнаты: габариты, розетки, сантехника → строки сметы."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import EstimateLine, LineType, Room
from app.services.calc.estimate import calc_room_metrics

OUTLET_WORK = 850
OUTLET_MAT = 200
PLUMBING_WORK = 3500
PLUMBING_MAT = 1200

ROOM_MUTABLE_FIELDS = frozenset(
    {
        "name",
        "room_type",
        "floor_level",
        "length_m",
        "width_m",
        "height_m",
        "openings_sq_m",
        "outlets_count",
        "switches_count",
        "plumbing_points",
        "notes",
        "budget_alert_pct",
    }
)
ROOM_DIRECT_MUTABLE_FIELDS = ROOM_MUTABLE_FIELDS | {"is_archived"}
_COUNT_FIELDS = frozenset({"outlets_count", "switches_count", "plumbing_points"})
_POSITIVE_FIELDS = frozenset({"length_m", "width_m", "height_m"})
_NON_NEGATIVE_FIELDS = frozenset({"openings_sq_m", "budget_alert_pct"})
_NULLABLE_FIELDS = frozenset({"room_type", "notes", "budget_alert_pct"})


def validate_room_patch(data: dict, *, allow_archive: bool = False) -> dict:
    """Return a normalized, safe room patch or fail closed on unknown fields."""
    if not isinstance(data, dict) or not data:
        raise ValueError("room_patch_empty")
    allowed_fields = ROOM_DIRECT_MUTABLE_FIELDS if allow_archive else ROOM_MUTABLE_FIELDS
    unknown = sorted(set(data) - allowed_fields)
    if unknown:
        raise ValueError(f"room_patch_field_forbidden:{unknown[0]}")

    normalized: dict = {}
    for field, value in data.items():
        if value is None:
            if field not in _NULLABLE_FIELDS:
                raise ValueError(f"room_patch_value_required:{field}")
            normalized[field] = None
            continue
        if field == "is_archived":
            if not isinstance(value, bool):
                raise ValueError("room_patch_archive_invalid")
            normalized[field] = value
            continue
        if field == "name":
            text = str(value).strip()
            if not text or len(text) > 100:
                raise ValueError("room_patch_name_invalid")
            normalized[field] = text
            continue
        if field == "room_type":
            text = str(value).strip()
            if not text or len(text) > 32:
                raise ValueError("room_patch_room_type_invalid")
            normalized[field] = text
            continue
        if field == "notes":
            text = str(value).strip()
            normalized[field] = text or None
            continue
        if field == "floor_level":
            if isinstance(value, bool):
                raise ValueError("room_patch_floor_level_invalid")
            try:
                parsed = int(value)
            except (TypeError, ValueError) as error:
                raise ValueError("room_patch_floor_level_invalid") from error
            if parsed < -20 or parsed > 200:
                raise ValueError("room_patch_floor_level_invalid")
            normalized[field] = parsed
            continue
        if field in _COUNT_FIELDS:
            if isinstance(value, bool):
                raise ValueError(f"room_patch_count_invalid:{field}")
            try:
                parsed = int(value)
            except (TypeError, ValueError) as error:
                raise ValueError(f"room_patch_count_invalid:{field}") from error
            if parsed < 0 or float(value) != float(parsed):
                raise ValueError(f"room_patch_count_invalid:{field}")
            normalized[field] = parsed
            continue
        if field in _POSITIVE_FIELDS | _NON_NEGATIVE_FIELDS:
            if isinstance(value, bool):
                raise ValueError(f"room_patch_number_invalid:{field}")
            try:
                parsed_float = float(value)
            except (TypeError, ValueError) as error:
                raise ValueError(f"room_patch_number_invalid:{field}") from error
            if field in _POSITIVE_FIELDS and parsed_float <= 0:
                raise ValueError(f"room_patch_number_invalid:{field}")
            if field in _NON_NEGATIVE_FIELDS and parsed_float < 0:
                raise ValueError(f"room_patch_number_invalid:{field}")
            normalized[field] = parsed_float
            continue
        raise ValueError(f"room_patch_field_forbidden:{field}")
    return normalized


def _audit_value(value: object) -> str:
    return ("null" if value is None else str(value))[:255]


async def apply_room_patch(
    db: AsyncSession,
    room: Room,
    data: dict,
    *,
    user_id: str | None = None,
    allow_archive: bool = False,
) -> dict[str, dict[str, object]]:
    """Apply a validated patch and audit changed fields without committing."""
    from app.models.entities import RoomChangeLog

    patch = validate_room_patch(data, allow_archive=allow_archive)
    changes: dict[str, dict[str, object]] = {}
    for field, value in patch.items():
        old = getattr(room, field)
        if old == value:
            continue
        changes[field] = {"from": old, "to": value}
        if user_id:
            db.add(
                RoomChangeLog(
                    room_id=room.id,
                    user_id=user_id,
                    field_name=field,
                    old_value=_audit_value(old),
                    new_value=_audit_value(value),
                )
            )
        setattr(room, field, value)
    await db.flush()
    return changes


async def update_room(
    db: AsyncSession,
    room_id: str,
    data: dict,
    user_id: str | None = None,
    threshold_pct: float = 10,
) -> Room | None:
    room = await db.get(Room, room_id)
    if not room:
        return None
    # Preserve legacy direct-editor semantics: explicit null for a required field
    # is a no-op, while nullable fields can still be cleared.
    direct_patch = {
        field: value
        for field, value in data.items()
        if value is not None or field in _NULLABLE_FIELDS
    }
    if direct_patch:
        await apply_room_patch(
            db,
            room,
            direct_patch,
            user_id=user_id,
            allow_archive=True,
        )
    await sync_room_estimate_lines(db, room, commit=False)
    await db.commit()
    await db.refresh(room)

    from app.models.entities import Project
    from app.services import notification_service as ns

    proj = await db.get(Project, room.project_id)
    lines = (
        await db.execute(select(EstimateLine).where(EstimateLine.room_id == room.id))
    ).scalars().all()
    plan = sum(line.quantity_planned * line.unit_price for line in lines)
    fact = sum(line.quantity_actual * line.unit_price for line in lines)
    if proj and proj.customer_id:
        await ns.notify(
            db,
            user_id=proj.customer_id,
            project_id=proj.id,
            notification_type="room_updated",
            title="Обновлена комната",
            body=room.name,
            link_path=f"/room/{room.id}",
            return_to="/(customer)/(tabs)/object?tab=rooms",
        )
    if proj and proj.customer_id and fact > plan and plan > 0:
        await ns.notify(
            db,
            user_id=proj.customer_id,
            project_id=proj.id,
            notification_type="change_order",
            title="Превышение бюджета комнаты",
            body=f"{room.name}: +{fact-plan:.0f} RUB",
            link_path=f"/room/{room.id}",
            return_to="/(customer)/(tabs)/object?tab=rooms",
        )
    return room


async def sync_room_estimate_lines(
    db: AsyncSession,
    room: Room,
    *,
    commit: bool = True,
) -> None:
    """Rebuild electrical/plumbing estimate rows; optionally join caller transaction."""
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

    await db.flush()
    from app.services.budget_service import sync_project_budget_planned

    await sync_project_budget_planned(db, room.project_id)
    if commit:
        await db.commit()


def room_detail(room: Room) -> dict:
    metrics = calc_room_metrics(
        room.length_m,
        room.width_m,
        room.height_m,
        room.openings_sq_m,
    )
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
        "floor_sq_m": metrics.floor_sq_m,
        "wall_sq_m": metrics.wall_sq_m,
        "perimeter_m": metrics.perimeter_m,
        "is_archived": getattr(room, "is_archived", False),
    }


async def create_room(
    db: AsyncSession,
    project_id: str,
    data: dict,
    user_id: str | None = None,
) -> Room | None:
    """Добавляет комнату в существующий проект и пересчитывает смету."""
    from app.models.entities import Project
    from app.services.calc.estimate import effective_renovation_type, generate_lines
    from app.services.budget_service import sync_project_budget_planned

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

    metrics = calc_room_metrics(
        room.length_m,
        room.width_m,
        room.height_m,
        room.openings_sq_m,
    )
    renovation_type = effective_renovation_type(
        project.renovation_type,
        room.room_type,
    )
    for calculated in generate_lines(
        renovation_type,
        room.id,
        room.name,
        metrics,
    ):
        db.add(
            EstimateLine(
                project_id=project_id,
                room_id=calculated.room_id,
                line_type=LineType(calculated.line_type),
                name=calculated.name,
                unit=calculated.unit,
                quantity_planned=calculated.quantity,
                unit_price=calculated.unit_price,
                room_name=calculated.room_name,
                category="finish",
            )
        )

    if room.outlets_count or room.plumbing_points:
        await sync_room_estimate_lines(db, room, commit=False)
    else:
        await sync_project_budget_planned(db, project_id)
    await db.commit()
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
