"""Rooms, derived quantities and generated estimate projections."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import EstimateLine, LineType, Project, Room
from app.services.calc.estimate import (
    calc_room_metrics,
    effective_renovation_type,
    generate_lines,
)

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


@dataclass(frozen=True)
class GeneratedEstimateLine:
    category: str
    line_type: LineType
    name: str
    unit: str
    quantity: float
    unit_price: float
    calc_detail: str | None = None


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


def _finish_lines(project: Project, room: Room) -> list[GeneratedEstimateLine]:
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
    return [
        GeneratedEstimateLine(
            category="finish",
            line_type=LineType(calculated.line_type),
            name=calculated.name,
            unit=calculated.unit,
            quantity=calculated.quantity,
            unit_price=calculated.unit_price,
        )
        for calculated in generate_lines(
            renovation_type,
            room.id,
            room.name,
            metrics,
        )
    ]


def _electrical_lines(room: Room) -> list[GeneratedEstimateLine]:
    if room.outlets_count <= 0:
        return []
    quantity = room.outlets_count
    return [
        GeneratedEstimateLine(
            category="electrical",
            line_type=LineType.work,
            name="Монтаж розеток",
            unit="шт",
            quantity=quantity,
            unit_price=OUTLET_WORK,
            calc_detail=f"{quantity} шт × {OUTLET_WORK} ₽/шт",
        ),
        GeneratedEstimateLine(
            category="electrical",
            line_type=LineType.material,
            name="Розетки + подрозетники",
            unit="шт",
            quantity=quantity,
            unit_price=OUTLET_MAT,
            calc_detail=f"{quantity} шт × {OUTLET_MAT} ₽/шт",
        ),
    ]


def _plumbing_lines(room: Room) -> list[GeneratedEstimateLine]:
    if room.plumbing_points <= 0:
        return []
    quantity = room.plumbing_points
    return [
        GeneratedEstimateLine(
            category="plumbing",
            line_type=LineType.work,
            name="Разводка сантехники",
            unit="точка",
            quantity=quantity,
            unit_price=PLUMBING_WORK,
            calc_detail=f"{quantity} точек × {PLUMBING_WORK} ₽",
        ),
        GeneratedEstimateLine(
            category="plumbing",
            line_type=LineType.material,
            name="Материалы сантехники",
            unit="точка",
            quantity=quantity,
            unit_price=PLUMBING_MAT,
            calc_detail=f"{quantity} × {PLUMBING_MAT} ₽",
        ),
    ]


def _line_key(line_type: LineType | str, name: str) -> tuple[str, str]:
    value = line_type.value if hasattr(line_type, "value") else str(line_type)
    return value, name


async def _sync_generated_category(
    db: AsyncSession,
    *,
    room: Room,
    category: str,
    generated: list[GeneratedEstimateLine],
) -> None:
    """Synchronize system rows in place, preserving manual price/fact evidence."""
    existing = list(
        (
            await db.execute(
                select(EstimateLine)
                .where(
                    EstimateLine.room_id == room.id,
                    EstimateLine.category == category,
                )
                .order_by(EstimateLine.id.asc())
            )
        ).scalars().all()
    )
    grouped: dict[tuple[str, str], list[EstimateLine]] = {}
    for line in existing:
        grouped.setdefault(_line_key(line.line_type, line.name), []).append(line)

    retained_ids: set[str] = set()
    for specification in generated:
        key = _line_key(specification.line_type, specification.name)
        candidates = grouped.get(key, [])
        line = candidates.pop(0) if candidates else None
        if line is None:
            line = EstimateLine(
                project_id=room.project_id,
                room_id=room.id,
                line_type=specification.line_type,
                name=specification.name,
                unit=specification.unit,
                quantity_planned=specification.quantity,
                unit_price=specification.unit_price,
                room_name=room.name,
                category=category,
                calc_detail=specification.calc_detail,
            )
            db.add(line)
            await db.flush()
        else:
            line.line_type = specification.line_type
            line.unit = specification.unit
            line.quantity_planned = specification.quantity
            line.room_name = room.name
            line.category = category
            line.calc_detail = specification.calc_detail
        retained_ids.add(line.id)

    for line in existing:
        if line.id not in retained_ids:
            await db.delete(line)
    await db.flush()


async def sync_room_estimate_lines(
    db: AsyncSession,
    room: Room,
    *,
    commit: bool = True,
) -> None:
    """Synchronize every system-derived room line and the project plan."""
    project = await db.get(Project, room.project_id)
    if project is None:
        raise ValueError("room_project_not_found")

    await _sync_generated_category(
        db,
        room=room,
        category="finish",
        generated=_finish_lines(project, room),
    )
    await _sync_generated_category(
        db,
        room=room,
        category="electrical",
        generated=_electrical_lines(room),
    )
    await _sync_generated_category(
        db,
        room=room,
        category="plumbing",
        generated=_plumbing_lines(room),
    )

    from app.services.budget_service import sync_project_budget_planned

    await sync_project_budget_planned(db, room.project_id)
    if commit:
        await db.commit()


async def prepare_room(
    db: AsyncSession,
    *,
    project: Project,
    data: dict,
) -> Room:
    """Create a room and all generated estimate rows without committing."""
    room = Room(
        project_id=project.id,
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
    await sync_room_estimate_lines(db, room, commit=False)
    return room


async def update_room(
    db: AsyncSession,
    room_id: str,
    data: dict,
    user_id: str | None = None,
    threshold_pct: float = 10,
) -> Room | None:
    """Compatibility writer; HTTP mutations use room_mutation_service."""
    room = await db.get(Room, room_id)
    if not room:
        return None
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
    return room


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
    """Compatibility writer; HTTP mutations use room_mutation_service."""
    project = await db.get(Project, project_id)
    if not project:
        return None
    room = await prepare_room(db, project=project, data=data)
    await db.commit()
    await db.refresh(room)
    return room
