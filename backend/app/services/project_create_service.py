"""Atomic, replay-safe project creation with exact schedule and budget allocation."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_DOWN
import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Project, Stage, StageStatus
from app.services import outbox_service as outbox
from app.services import room_service
from app.services.calc.estimate import stages_for_renovation

PROJECT_CREATE_SCOPE = "project.create"
PROJECT_TEMPLATE_CREATE_SCOPE = "project.create.template"
_CENT = Decimal("0.01")

_STAGE_ROOM_TYPES: dict[str, tuple[str, ...]] = {
    "сантех": ("bathroom", "toilet", "kitchen"),
    "гидро": ("bathroom", "toilet"),
    "плитк": ("bathroom", "toilet", "kitchen"),
    "фартук": ("kitchen",),
}


@dataclass(frozen=True)
class ProjectCreateResult:
    project: Project
    replayed: bool


def _money(value: float | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(_CENT)


def _normalized_rooms(rooms_data: list[dict]) -> list[dict]:
    if not rooms_data:
        raise ValueError("project_rooms_required")
    result: list[dict] = []
    for index, source in enumerate(rooms_data):
        try:
            name = str(source["name"]).strip()
            length = float(source["length_m"])
            width = float(source["width_m"])
            height = float(source.get("height_m", 2.7))
            openings = float(source.get("openings_sq_m", 2))
            floor_level = int(source.get("floor_level", 1))
            outlets = int(source.get("outlets_count", 0))
            switches = int(source.get("switches_count", 0))
            plumbing = int(source.get("plumbing_points", 0))
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"project_room_invalid:{index}") from error
        if not name or len(name) > 100:
            raise ValueError(f"project_room_invalid:{index}")
        if length <= 0 or width <= 0 or height <= 0 or openings < 0:
            raise ValueError(f"project_room_invalid:{index}")
        if outlets < 0 or switches < 0 or plumbing < 0:
            raise ValueError(f"project_room_invalid:{index}")
        room_type = source.get("room_type")
        if room_type is not None:
            room_type = str(room_type).strip() or None
            if room_type and len(room_type) > 32:
                raise ValueError(f"project_room_invalid:{index}")
        notes = source.get("notes")
        if notes is not None:
            notes = str(notes).strip() or None
        alert = source.get("budget_alert_pct")
        if alert is not None:
            try:
                alert = float(alert)
            except (TypeError, ValueError) as error:
                raise ValueError(f"project_room_invalid:{index}") from error
            if alert < 0:
                raise ValueError(f"project_room_invalid:{index}")
        result.append(
            {
                "name": name,
                "room_type": room_type,
                "floor_level": floor_level,
                "length_m": length,
                "width_m": width,
                "height_m": height,
                "openings_sq_m": openings,
                "outlets_count": outlets,
                "switches_count": switches,
                "plumbing_points": plumbing,
                "notes": notes,
                "budget_alert_pct": alert,
            }
        )
    return result


def _project_payload(
    *,
    name: str,
    address: str | None,
    renovation_type: str,
    property_type: str,
    total_area_sqm: float | None,
    planned_start_date: date | None,
    planned_end_date: date | None,
    rooms_data: list[dict],
    contractor_id: str | None,
    template_id: str | None,
) -> dict:
    clean_name = name.strip()
    if not clean_name or len(clean_name) > 255:
        raise ValueError("project_name_invalid")
    clean_address = (address or "").strip() or None
    clean_renovation = (renovation_type or "").strip()
    clean_property = (property_type or "").strip()
    if not clean_renovation or not clean_property:
        raise ValueError("project_type_invalid")
    rooms = _normalized_rooms(rooms_data)
    area = total_area_sqm
    if area is None:
        area = round(sum(room["length_m"] * room["width_m"] for room in rooms), 2)
    else:
        area = float(area)
        if area <= 0:
            raise ValueError("project_area_invalid")
    start = planned_start_date or date.today()
    end = planned_end_date or (start + timedelta(days=60))
    if end < start:
        raise ValueError("project_dates_invalid")
    return {
        "name": clean_name,
        "address": clean_address,
        "renovation_type": clean_renovation,
        "property_type": clean_property,
        "total_area_sqm": area,
        "planned_start_date": start.isoformat(),
        "planned_end_date": end.isoformat(),
        "rooms": rooms,
        "contractor_id": contractor_id,
        "template_id": template_id,
    }


def _normalized_weights(plans: list[tuple[str, float]]) -> list[Decimal]:
    weights = [Decimal(str(weight)) for _, weight in plans]
    total = sum(weights, Decimal("0"))
    if total <= 0:
        raise ValueError("project_stage_weights_invalid")
    return [weight / total for weight in weights]


def _allocate_stage_days(
    *,
    start: date,
    end: date,
    plans: list[tuple[str, float]],
) -> list[int]:
    count = len(plans)
    total_days = (end - start).days + 1
    if count == 0:
        raise ValueError("project_stages_required")
    if total_days < count:
        raise ValueError("project_schedule_too_short")
    weights = _normalized_weights(plans)
    distributable = total_days - count
    raw = [Decimal(distributable) * weight for weight in weights]
    base = [1 + int(value.to_integral_value(rounding=ROUND_DOWN)) for value in raw]
    remainder = total_days - sum(base)
    order = sorted(
        range(count),
        key=lambda index: (raw[index] - int(raw[index]), -index),
        reverse=True,
    )
    for index in order[:remainder]:
        base[index] += 1
    return base


def _allocate_stage_amounts(
    *,
    budget: float,
    plans: list[tuple[str, float]],
) -> list[float]:
    weights = _normalized_weights(plans)
    total_cents = int((_money(budget) * 100).to_integral_value())
    raw = [Decimal(total_cents) * weight for weight in weights]
    cents = [int(value.to_integral_value(rounding=ROUND_DOWN)) for value in raw]
    remainder = total_cents - sum(cents)
    order = sorted(
        range(len(plans)),
        key=lambda index: (raw[index] - cents[index], -index),
        reverse=True,
    )
    for index in order[:remainder]:
        cents[index] += 1
    return [float(Decimal(value) / 100) for value in cents]


def _suggest_room_ids(stage_name: str, rooms: list) -> list[str]:
    lowered = stage_name.lower()
    for marker, room_types in _STAGE_ROOM_TYPES.items():
        if marker in lowered:
            return [room.id for room in rooms if room.room_type in room_types]
    return []


async def _prepare_stages(
    db: AsyncSession,
    *,
    project: Project,
    rooms: list,
) -> list[Stage]:
    plans = list(stages_for_renovation(project.renovation_type))
    days = _allocate_stage_days(
        start=project.planned_start_date,
        end=project.planned_end_date,
        plans=plans,
    )
    amounts = _allocate_stage_amounts(
        budget=float(project.budget_planned or 0),
        plans=plans,
    )
    cursor = project.planned_start_date
    stages: list[Stage] = []
    for index, ((stage_name, weight), duration, amount) in enumerate(
        zip(plans, days, amounts, strict=True)
    ):
        stage_end = cursor + timedelta(days=duration - 1)
        room_ids = _suggest_room_ids(stage_name, rooms)
        stage = Stage(
            project_id=project.id,
            name=stage_name,
            sort_order=index,
            status=StageStatus.active if index == 0 else StageStatus.planned,
            percent_complete=0,
            payment_amount=amount,
            weight_coefficient=float(weight),
            planned_start=cursor,
            planned_end=stage_end,
            room_ids_json=json.dumps(room_ids) if room_ids else None,
        )
        db.add(stage)
        stages.append(stage)
        cursor = stage_end + timedelta(days=1)
    await db.flush()
    if stages[-1].planned_end != project.planned_end_date:
        raise ValueError("project_schedule_allocation_invalid")
    return stages


async def _prepare_activity(
    db: AsyncSession,
    *,
    project: Project,
    customer_id: str,
    rooms_count: int,
    stages_count: int,
) -> None:
    await outbox.enqueue(
        db,
        aggregate_type="project",
        aggregate_id=project.id,
        event_type=outbox.ACTIVITY_EVENT,
        payload={
            "project_id": project.id,
            "user_id": customer_id,
            "kind": "ProjectCreated",
            "title": f"Создан объект: {project.name}",
            "body": (
                f"Комнат: {rooms_count}; этапов: {stages_count}; "
                f"план: {float(project.budget_planned or 0):.2f} ₽"
            ),
            "link_path": "/(customer)/(tabs)/object",
        },
    )


async def _loaded_project(db: AsyncSession, project_id: str) -> Project:
    from app.services.project_service import get_project

    project = await get_project(db, project_id)
    if project is None:
        raise ValueError("project_creation_entity_missing")
    return project


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
    client_request_id: str | None = None,
    scope: str = PROJECT_CREATE_SCOPE,
    template_id: str | None = None,
) -> ProjectCreateResult:
    """Create one complete project or replay the already committed result."""
    from app.services.client_write_idempotency import commit_client_write, replay_entity_id

    payload = _project_payload(
        name=name,
        address=address,
        renovation_type=renovation_type,
        property_type=property_type,
        total_area_sqm=total_area_sqm,
        planned_start_date=planned_start_date,
        planned_end_date=planned_end_date,
        rooms_data=rooms_data,
        contractor_id=contractor_id,
        template_id=template_id,
    )
    replay_id = await replay_entity_id(
        db,
        scope=scope,
        project_id=customer_id,
        user_id=customer_id,
        request_id=client_request_id,
        payload=payload,
    )
    if replay_id:
        return ProjectCreateResult(await _loaded_project(db, replay_id), True)

    start = date.fromisoformat(payload["planned_start_date"])
    end = date.fromisoformat(payload["planned_end_date"])
    project = Project(
        name=payload["name"],
        address=payload["address"],
        renovation_type=payload["renovation_type"],
        property_type=payload["property_type"],
        total_area_sqm=payload["total_area_sqm"],
        customer_id=customer_id,
        contractor_id=contractor_id,
        planned_start_date=start,
        planned_end_date=end,
    )
    db.add(project)
    try:
        await db.flush()
        rooms = [
            await room_service.prepare_room(db, project=project, data=room_data)
            for room_data in payload["rooms"]
        ]
        stages = await _prepare_stages(db, project=project, rooms=rooms)
        await _prepare_activity(
            db,
            project=project,
            customer_id=customer_id,
            rooms_count=len(rooms),
            stages_count=len(stages),
        )
        candidate_id = project.id
        created, entity_id = await commit_client_write(
            db,
            scope=scope,
            project_id=customer_id,
            user_id=customer_id,
            request_id=client_request_id,
            payload=payload,
            entity_id=candidate_id,
        )
    except BaseException:
        await db.rollback()
        raise

    if not created:
        return ProjectCreateResult(await _loaded_project(db, entity_id), True)
    loaded = await _loaded_project(db, candidate_id)
    from app.services.outbox_inline_dispatch import dispatch_best_effort

    await dispatch_best_effort(db, source="project.create", limit=10)
    return ProjectCreateResult(loaded, False)


async def create_from_template(
    db: AsyncSession,
    *,
    customer_id: str,
    template_id: str,
    name: str | None = None,
    client_request_id: str | None = None,
) -> ProjectCreateResult:
    from app.services.project_service import PROJECT_TEMPLATES

    template = PROJECT_TEMPLATES.get(template_id)
    if template is None:
        raise ValueError("unknown_template")
    return await create_project(
        db,
        customer_id=customer_id,
        name=(name or f"{template['label']} (шаблон)").strip(),
        address=None,
        renovation_type=template["renovation_type"],
        rooms_data=template["rooms"],
        property_type=template["property_type"],
        client_request_id=client_request_id,
        scope=PROJECT_TEMPLATE_CREATE_SCOPE,
        template_id=template_id,
    )
