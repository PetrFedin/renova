"""Idempotent rich demo fixture for review/development runtimes.

The canonical demo users/projects are created by ``seed_demo``. This module adds
mid-life project state so every major RENOVA hub has meaningful data to render.
It is never invoked by staging/production startup.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import utc_now
from app.models.entities import (
    AppNotification,
    ChangeOrder,
    ChangeOrderStatus,
    EstimateLine,
    Expense,
    FloorPlan,
    FloorPlanPin,
    FurnitureItem,
    JobLead,
    JobLeadQuote,
    JobLeadStatus,
    LineType,
    NotificationType,
    Payment,
    PaymentStatus,
    PaymentType,
    Project,
    ProjectIssue,
    PropertyObject,
    Receipt,
    Room,
    SelectionItem,
    SelectionStatus,
    Stage,
    StageStatus,
    WasteOrder,
    WasteOrderStatus,
)
from app.models.work_schedule import (
    ProjectWorkSchedule,
    ProjectWorkScheduleItem,
    WorkScheduleItemStatus,
    WorkScheduleStatus,
)

SHOWCASE_PREFIX = "Демо ·"

_STAGE_NAMES = [
    "Демонтаж и подготовка",
    "Черновая электрика",
    "Сантехника",
    "Выравнивание стен",
    "Плиточные работы",
    "Чистовая отделка",
    "Установка дверей и света",
    "Финальная комплектация",
]

_ESTIMATE_TEMPLATES = [
    ("Демонтаж перегородок", "работы", "м²", 18, 950),
    ("Вывоз строительного мусора", "работы", "м³", 5, 4200),
    ("Грунтовка стен", "материалы", "л", 25, 280),
    ("Штукатурка стен", "работы", "м²", 110, 780),
    ("Шпаклёвка стен", "работы", "м²", 110, 620),
    ("Кабель силовой", "материалы", "м", 180, 115),
    ("Монтаж розеток", "работы", "шт", 18, 850),
    ("Розетки и рамки", "материалы", "шт", 18, 720),
    ("Коллектор водоснабжения", "материалы", "шт", 1, 18500),
    ("Разводка сантехники", "работы", "точка", 7, 5200),
    ("Гидроизоляция ванной", "работы", "м²", 12, 1450),
    ("Керамогранит", "материалы", "м²", 24, 3850),
    ("Укладка плитки", "работы", "м²", 24, 3100),
    ("Ламинат", "материалы", "м²", 42, 2250),
    ("Укладка напольного покрытия", "работы", "м²", 42, 980),
    ("Краска интерьерная", "материалы", "л", 28, 920),
    ("Окраска стен", "работы", "м²", 110, 740),
    ("Межкомнатные двери", "материалы", "шт", 4, 28500),
    ("Монтаж дверей", "работы", "шт", 4, 6800),
    ("Трековое освещение", "материалы", "компл", 2, 26500),
]


def _category(index: int) -> str:
    return ("works", "materials", "electrical", "plumbing", "finish")[index % 5]


async def _ensure_stage_mix(
    db: AsyncSession,
    project: Project,
    contractor_id: str,
    rooms: list[Room],
) -> list[Stage]:
    stages = list(
        (
            await db.execute(
                select(Stage).where(Stage.project_id == project.id).order_by(Stage.sort_order.asc())
            )
        ).scalars().all()
    )
    existing_names = {s.name for s in stages}
    for idx, name in enumerate(_STAGE_NAMES):
        if len(stages) >= 8:
            break
        if name in existing_names:
            continue
        stage = Stage(
            project_id=project.id,
            name=name,
            sort_order=len(stages),
            status=StageStatus.planned,
            percent_complete=0,
            payment_amount=45000 + len(stages) * 7500,
            weight_coefficient=1,
            work_type=("demolition", "electrical", "plumbing", "walls", "tiling", "painting", "finishing", "handover")[len(stages) % 8],
            assignee_id=contractor_id,
            room_ids_json=json.dumps([r.id for r in rooms[: max(1, min(2, len(rooms)))]]),
        )
        db.add(stage)
        stages.append(stage)
        existing_names.add(name)
    await db.flush()
    stages = sorted(stages, key=lambda s: s.sort_order)[:8]

    today = date.today()
    states = [
        (StageStatus.done, 100, False),
        (StageStatus.done, 100, False),
        (StageStatus.review, 92, False),
        (StageStatus.active, 55, True),
        (StageStatus.active, 45, False),
        (StageStatus.active, 25, False),
        (StageStatus.planned, 0, False),
        (StageStatus.planned, 0, False),
    ]
    for idx, stage in enumerate(stages):
        status, percent, needs_rework = states[idx]
        stage.sort_order = idx
        stage.status = status
        stage.percent_complete = percent
        stage.needs_rework = needs_rework
        stage.assignee_id = contractor_id
        stage.planned_start = today + timedelta(days=(idx - 3) * 7)
        stage.planned_end = stage.planned_start + timedelta(days=6)
        stage.actual_start = stage.planned_start if status != StageStatus.planned else None
        stage.actual_end = stage.planned_end if status == StageStatus.done else None
        stage.contractor_ready = status in {StageStatus.review, StageStatus.done}
        stage.customer_accepted_at = utc_now() - timedelta(days=14 - idx * 3) if status == StageStatus.done else None
        stage.rework_deadline = utc_now() + timedelta(days=3) if needs_rework else None
        stage.notes = (
            "Демо: требуется устранить замечание по геометрии стены"
            if needs_rework
            else "Демо: состояние этапа для полного review-сценария"
        )
    project.progress_percent = 48.0
    project.planned_start_date = today - timedelta(days=35)
    project.planned_end_date = today + timedelta(days=42)
    return stages


async def _ensure_estimate_density(
    db: AsyncSession,
    project: Project,
    rooms: list[Room],
) -> list[EstimateLine]:
    lines = list(
        (
            await db.execute(
                select(EstimateLine).where(EstimateLine.project_id == project.id).order_by(EstimateLine.id.asc())
            )
        ).scalars().all()
    )
    needed = max(0, 40 - len(lines))
    for offset in range(needed):
        idx = len(lines) + offset
        base = _ESTIMATE_TEMPLATES[idx % len(_ESTIMATE_TEMPLATES)]
        name, kind, unit, quantity, price = base
        room = rooms[idx % len(rooms)] if rooms else None
        row = EstimateLine(
            project_id=project.id,
            room_id=room.id if room else None,
            line_type=LineType.work if kind == "работы" else LineType.material,
            name=f"{SHOWCASE_PREFIX}{name} #{idx + 1}",
            unit=unit,
            quantity_planned=float(quantity),
            quantity_actual=float(quantity) * (0.2 + (idx % 5) * 0.15),
            unit_price=float(price),
            room_name=room.name if room else None,
            category=_category(idx),
            calc_detail="showcase: realistic mid-life project fixture",
        )
        db.add(row)
        lines.append(row)
    await db.flush()
    project.budget_planned = round(
        sum(float(x.quantity_planned or 0) * float(x.unit_price or 0) for x in lines),
        2,
    )
    return lines


async def _ensure_object_and_plan(db: AsyncSession, project: Project, rooms: list[Room], contractor_id: str) -> None:
    obj = (
        await db.execute(select(PropertyObject).where(PropertyObject.project_id == project.id).limit(1))
    ).scalar_one_or_none()
    if not obj:
        db.add(
            PropertyObject(
                project_id=project.id,
                object_type="apartment",
                total_area_sqm=project.total_area_sqm or 52,
                floors_count=1,
                rooms_count=len(rooms),
                ceiling_height_m=2.7,
                build_year=2014,
                building_type="monolith",
                has_elevator=True,
                condition_before="secondary",
                has_demolition=True,
                has_replanning=False,
                has_design_project=True,
                has_contractor=True,
                notes="Демо: паспорт объекта заполнен для review",
            )
        )

    plan = (
        await db.execute(select(FloorPlan).where(FloorPlan.project_id == project.id).limit(1))
    ).scalar_one_or_none()
    if not plan:
        plan = FloorPlan(
            project_id=project.id,
            name="Демо-план квартиры",
            image_key="demo/floor-plan.svg",
            width_px=1200,
            height_px=800,
            floor_level=1,
        )
        db.add(plan)
        await db.flush()

    pin_positions = [(25, 34), (68, 32), (73, 72), (32, 72)]
    for idx, room in enumerate(rooms[:4]):
        existing = (
            await db.execute(
                select(FloorPlanPin).where(
                    FloorPlanPin.floor_plan_id == plan.id,
                    FloorPlanPin.room_id == room.id,
                ).limit(1)
            )
        ).scalar_one_or_none()
        if not existing:
            x_pct, y_pct = pin_positions[idx]
            db.add(FloorPlanPin(floor_plan_id=plan.id, room_id=room.id, x_pct=x_pct, y_pct=y_pct, label=room.name))

    punch = (
        await db.execute(
            select(ProjectIssue).where(
                ProjectIssue.project_id == project.id,
                ProjectIssue.title == f"{SHOWCASE_PREFIX}Проверить угол стены",
            ).limit(1)
        )
    ).scalar_one_or_none()
    if not punch:
        db.add(
            ProjectIssue(
                project_id=project.id,
                room_id=rooms[0].id if rooms else None,
                title=f"{SHOWCASE_PREFIX}Проверить угол стены",
                description="Punch-list: отклонение 6 мм, требуется перепроверка после исправления",
                severity="medium",
                status="in_progress",
                assignee_id=contractor_id,
                due_at=utc_now() + timedelta(days=2),
                floor_plan_id=plan.id,
                x_pct=31,
                y_pct=38,
            )
        )

    existing_furniture = (
        await db.execute(select(func.count()).select_from(FurnitureItem).where(FurnitureItem.project_id == project.id))
    ).scalar_one()
    if int(existing_furniture or 0) == 0 and rooms:
        db.add_all(
            [
                FurnitureItem(project_id=project.id, room_id=rooms[0].id, floor_plan_id=plan.id, name="Диван", width_m=2.2, depth_m=0.9, height_m=0.8, x_pct=24, y_pct=45),
                FurnitureItem(project_id=project.id, room_id=rooms[1].id if len(rooms) > 1 else rooms[0].id, floor_plan_id=plan.id, name="Кровать", width_m=1.8, depth_m=2.1, height_m=0.6, x_pct=70, y_pct=39),
            ]
        )

    waste = (
        await db.execute(
            select(WasteOrder).where(WasteOrder.project_id == project.id, WasteOrder.notes == "showcase").limit(1)
        )
    ).scalar_one_or_none()
    if not waste:
        db.add(
            WasteOrder(
                project_id=project.id,
                room_id=rooms[0].id if rooms else None,
                volume_m3=6,
                waste_type="construction",
                scheduled_date=date.today() + timedelta(days=1),
                status=WasteOrderStatus.scheduled,
                price=14500,
                notes="showcase",
            )
        )


async def _ensure_selections(db: AsyncSession, project: Project, rooms: list[Room], contractor_id: str) -> None:
    existing = list(
        (
            await db.execute(
                select(SelectionItem).where(
                    SelectionItem.project_id == project.id,
                    SelectionItem.notes.like("showcase:%"),
                )
            )
        ).scalars().all()
    )
    if existing:
        return
    fixtures = [
        ("Керамогранит 60×60", "tile", 4200, 3850, SelectionStatus.proposed),
        ("Смеситель скрытого монтажа", "plumbing", 36000, 32900, SelectionStatus.approved),
        ("Подвесной светильник", "lighting", 28000, 34500, SelectionStatus.proposed),
        ("Дверь скрытого монтажа", "doors", 62000, 69500, SelectionStatus.rejected),
        ("Краска тёплый белый", "paint", 14000, 12800, SelectionStatus.draft),
    ]
    for idx, (title, category, allowance, price, status) in enumerate(fixtures):
        db.add(
            SelectionItem(
                project_id=project.id,
                room_id=rooms[idx % len(rooms)].id if rooms else None,
                category=category,
                title=f"{SHOWCASE_PREFIX}{title}",
                sku=f"RV-{1000 + idx}",
                allowance=allowance,
                price=price,
                shop_url="https://example.invalid/renova-demo",
                shop_name="Демо-магазин",
                status=status,
                notes=f"showcase:{status.value}",
                proposed_by_id=contractor_id,
                approved_at=utc_now() - timedelta(days=2) if status == SelectionStatus.approved else None,
            )
        )


async def _ensure_schedule(db: AsyncSession, project: Project, customer_id: str, stages: list[Stage]) -> None:
    schedule = (
        await db.execute(
            select(ProjectWorkSchedule).where(ProjectWorkSchedule.project_id == project.id).limit(1)
        )
    ).scalar_one_or_none()
    if not schedule:
        schedule = ProjectWorkSchedule(
            project_id=project.id,
            status=WorkScheduleStatus.confirmed,
            title="Демо · План-график проекта",
            description="Полный mid-life график: завершено, задержка, блокировка, будущие работы",
            planned_start_date=project.planned_start_date,
            planned_finish_date=project.planned_end_date,
            created_by=customer_id,
            submitted_by=customer_id,
            confirmed_by=customer_id,
            submitted_at=utc_now() - timedelta(days=30),
            confirmed_at=utc_now() - timedelta(days=29),
        )
        db.add(schedule)
        await db.flush()

    existing_stage_ids = set(
        (
            await db.execute(
                select(ProjectWorkScheduleItem.stage_id).where(ProjectWorkScheduleItem.schedule_id == schedule.id)
            )
        ).scalars().all()
    )
    statuses = [
        WorkScheduleItemStatus.accepted,
        WorkScheduleItemStatus.accepted,
        WorkScheduleItemStatus.submitted,
        WorkScheduleItemStatus.delayed,
        WorkScheduleItemStatus.in_progress,
        WorkScheduleItemStatus.in_progress,
        WorkScheduleItemStatus.planned,
        WorkScheduleItemStatus.blocked,
    ]
    today = date.today()
    for idx, stage in enumerate(stages[:8]):
        if stage.id in existing_stage_ids:
            continue
        start = today + timedelta(days=(idx - 3) * 7)
        finish = start + timedelta(days=6)
        status = statuses[idx]
        db.add(
            ProjectWorkScheduleItem(
                schedule_id=schedule.id,
                project_id=project.id,
                stage_id=stage.id,
                title=stage.name,
                description="showcase schedule item",
                status=status,
                planned_start_date=start,
                planned_finish_date=finish,
                actual_start_date=start if status not in {WorkScheduleItemStatus.planned, WorkScheduleItemStatus.blocked} else None,
                actual_finish_date=finish if status == WorkScheduleItemStatus.accepted else None,
                requires_customer_acceptance=True,
                requires_photo=True,
                delay_days=5 if status == WorkScheduleItemStatus.delayed else 0,
                blocking_reason="Ожидание поставки двери" if status == WorkScheduleItemStatus.blocked else None,
                sort_order=idx,
                progress_percent=float(stage.percent_complete or 0),
            )
        )


async def _ensure_expenses(db: AsyncSession, project: Project, rooms: list[Room], stages: list[Stage]) -> None:
    count = (
        await db.execute(
            select(func.count()).select_from(Expense).where(
                Expense.project_id == project.id,
                Expense.comment.like("showcase:%"),
            )
        )
    ).scalar_one()
    if int(count or 0) > 0:
        return
    fixtures = [
        ("Кабель и автоматы", "electrical", 43800, "confirmed"),
        ("Черновая сантехника", "plumbing", 67200, "confirmed"),
        ("Штукатурка и грунт", "materials", 51400, "confirmed"),
        ("Керамогранит ванная", "finish", 88900, "confirmed"),
        ("Ламинат", "finish", 94500, "confirmed"),
        ("Двери — аванс", "materials", 62000, "pending_receipt"),
        ("Светильники", "electrical", 54800, "confirmed"),
        ("Вывоз мусора", "works", 14500, "confirmed"),
        ("Доп. выравнивание", "works", 18500, "disputed"),
        ("Возврат лишней плитки", "finish", -9200, "refund"),
    ]
    for idx, (title, category, amount, status) in enumerate(fixtures):
        db.add(
            Expense(
                project_id=project.id,
                room_id=rooms[idx % len(rooms)].id if rooms else None,
                stage_id=stages[idx % len(stages)].id if stages else None,
                title=f"{SHOWCASE_PREFIX}{title}",
                category=category,
                amount=amount,
                currency="RUB",
                payment_method=("card", "bank_transfer", "sbp_manual")[idx % 3],
                supplier_name=("Петрович", "Лемана ПРО", "Демо-подрядчик")[idx % 3],
                comment=f"showcase:{status}",
                status=status,
                expense_date=utc_now() - timedelta(days=30 - idx * 3),
            )
        )


async def _ensure_payments_and_receipts(db: AsyncSession, project: Project, customer_id: str, stages: list[Stage]) -> None:
    existing_titles = set(
        (
            await db.execute(select(Payment.title).where(Payment.project_id == project.id))
        ).scalars().all()
    )
    created: list[Payment] = []
    for idx in range(15):
        title = f"{SHOWCASE_PREFIX}Оплата {idx + 1:02d}"
        if title in existing_titles:
            payment = (
                await db.execute(
                    select(Payment).where(Payment.project_id == project.id, Payment.title == title).limit(1)
                )
            ).scalar_one()
            created.append(payment)
            continue
        if idx < 12:
            status = PaymentStatus.confirmed
        elif idx == 12:
            status = PaymentStatus.paid_unverified
        elif idx == 13:
            status = PaymentStatus.confirmed
        else:
            status = PaymentStatus.disputed
        payment = Payment(
            project_id=project.id,
            stage_id=stages[idx % len(stages)].id if stages else None,
            payment_type=(PaymentType.stage if idx % 3 else PaymentType.material),
            status=status,
            title=title,
            amount=24000 + idx * 6500,
            notes=(
                "Демо: перевод отмечен, чек ещё не приложен"
                if idx == 12
                else "Демо: сумма чека требует сверки"
                if idx == 13
                else "Демо: платеж оспорен"
                if idx == 14
                else "Демо: подтверждённый платеж"
            ),
            created_by=customer_id,
            payment_method="bank_transfer" if idx % 2 else "card",
            confirmed_at=utc_now() - timedelta(days=max(1, 28 - idx * 2)) if status == PaymentStatus.confirmed else None,
            created_at=utc_now() - timedelta(days=max(0, 30 - idx * 2)),
        )
        db.add(payment)
        await db.flush()
        created.append(payment)

    for idx, payment in enumerate(created[:14]):
        receipt = (
            await db.execute(select(Receipt).where(Receipt.payment_id == payment.id).limit(1))
        ).scalar_one_or_none()
        if receipt:
            continue
        good = idx < 12
        mismatch = idx == 13
        db.add(
            Receipt(
                project_id=project.id,
                amount=(payment.amount + 2500 if mismatch else payment.amount),
                qr_raw=f"demo-receipt:{payment.id}",
                fn=f"DEMOFN{idx:02d}",
                fd=f"DEMOFD{idx:02d}",
                fns_verified=good,
                verification_status="demo_verified" if good else "saved_unverified",
                expense_category="materials" if idx % 2 else "works",
                stage_id=payment.stage_id,
                payment_id=payment.id,
                created_at=payment.created_at + timedelta(hours=2),
            )
        )


async def _ensure_change_order(db: AsyncSession, project: Project, contractor_id: str) -> None:
    title = f"{SHOWCASE_PREFIX}Допработы: шумоизоляция спальни"
    existing = (
        await db.execute(
            select(ChangeOrder).where(ChangeOrder.project_id == project.id, ChangeOrder.title == title).limit(1)
        )
    ).scalar_one_or_none()
    if not existing:
        db.add(
            ChangeOrder(
                project_id=project.id,
                title=title,
                description="На согласовании: дополнительный слой шумоизоляции и новая обрешётка",
                amount=48500,
                status=ChangeOrderStatus.pending,
                created_by=contractor_id,
            )
        )


async def _ensure_warranty(db: AsyncSession, project: Project, customer_id: str) -> None:
    existing = (
        await db.execute(
            select(ProjectIssue).where(
                ProjectIssue.project_id == project.id,
                ProjectIssue.title == "[Гарантия] Демо · Течь под раковиной",
            ).limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        return
    from app.services.warranty_claim_service import create_or_replay_warranty_claim

    await create_or_replay_warranty_claim(
        db,
        project=project,
        user_id=customer_id,
        title="Демо · Течь под раковиной",
        description="Контрольный гарантийный кейс: требуется осмотр соединения и фото после устранения.",
        client_request_id="demo-warranty-showcase-001",
    )


async def _ensure_marketplace(db: AsyncSession, customer_id: str, contractor_id: str) -> None:
    title = f"{SHOWCASE_PREFIX}Ремонт кухни 18 м²"
    lead = (
        await db.execute(select(JobLead).where(JobLead.customer_id == customer_id, JobLead.title == title).limit(1))
    ).scalar_one_or_none()
    if not lead:
        lead = JobLead(
            customer_id=customer_id,
            title=title,
            address="Москва, Ходынский бульвар",
            area_sqm=18,
            renovation_type="cosmetic",
            budget_hint=620000,
            description="Демо-заявка для показа контура поиска исполнителя",
            status=JobLeadStatus.quoted,
            pre_estimate=590000,
        )
        db.add(lead)
        await db.flush()
    quote = (
        await db.execute(
            select(JobLeadQuote).where(
                JobLeadQuote.lead_id == lead.id,
                JobLeadQuote.contractor_id == contractor_id,
            ).limit(1)
        )
    ).scalar_one_or_none()
    if not quote:
        db.add(JobLeadQuote(lead_id=lead.id, contractor_id=contractor_id, pre_estimate=575000, note="Демо: предложение с готовностью выйти через 5 дней"))


async def _ensure_notifications(db: AsyncSession, project: Project, customer_id: str, contractor_id: str) -> None:
    fixtures = [
        (customer_id, NotificationType.stage_review, "Этап ждёт приёмки", "Проверьте результат и фото по этапу", "/(customer)/(tabs)/repair?tab=control"),
        (customer_id, NotificationType.deadline, "Есть просрочка по графику", "Один пункт задержан на 5 дней", "/(customer)/(tabs)/calendar"),
        (customer_id, NotificationType.budget_alert, "Отклонение от бюджета", "По чистовой отделке факт выше плана", "/(customer)/(tabs)/budget?tab=deviations"),
        (contractor_id, NotificationType.approval, "Подбор ждёт решения", "Заказчик ещё не согласовал светильник", "/(contractor)/(tabs)/repair?tab=selections"),
    ]
    for user_id, ntype, title, body, link in fixtures:
        existing = (
            await db.execute(
                select(AppNotification).where(
                    AppNotification.user_id == user_id,
                    AppNotification.project_id == project.id,
                    AppNotification.title == title,
                ).limit(1)
            )
        ).scalar_one_or_none()
        if not existing:
            db.add(
                AppNotification(
                    user_id=user_id,
                    project_id=project.id,
                    notification_type=ntype,
                    title=title,
                    body=body,
                    link_path=link,
                    read=False,
                )
            )


async def ensure_showcase_project(
    db: AsyncSession,
    *,
    project_id: str,
    customer_id: str,
    contractor_id: str,
) -> dict[str, int | float | str | bool]:
    project = await db.get(Project, project_id)
    if not project:
        raise ValueError("showcase project missing")
    rooms = list(
        (await db.execute(select(Room).where(Room.project_id == project.id).order_by(Room.name.asc()))).scalars().all()
    )
    if not project.contractor_id:
        project.contractor_id = contractor_id

    stages = await _ensure_stage_mix(db, project, contractor_id, rooms)
    lines = await _ensure_estimate_density(db, project, rooms)
    await _ensure_object_and_plan(db, project, rooms, contractor_id)
    await _ensure_selections(db, project, rooms, contractor_id)
    await _ensure_schedule(db, project, customer_id, stages)
    await _ensure_expenses(db, project, rooms, stages)
    await _ensure_payments_and_receipts(db, project, customer_id, stages)
    await _ensure_change_order(db, project, contractor_id)
    await _ensure_warranty(db, project, customer_id)
    await _ensure_marketplace(db, customer_id, contractor_id)
    await _ensure_notifications(db, project, customer_id, contractor_id)
    await db.commit()

    # API reads recalculate budget truth from Expense/Receipt/Payment; run it here
    # as well so the home cards are already coherent before the first request.
    from app.services import budget_service as budget

    await budget.refresh_budget_facts(db, project.id)
    await db.commit()
    await db.refresh(project)

    return {
        "ok": True,
        "project_id": project.id,
        "stages": len(stages),
        "estimate_lines": len(lines),
        "budget_planned": round(float(project.budget_planned or 0), 2),
        "budget_spent": round(float(project.budget_spent or 0), 2),
    }
