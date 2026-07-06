"""Демо-данные — 2 роли + гостевой заказчик для read-only."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChatMessage, ChatMessageType, Project, User, UserRole, ProjectViewer
from app.services import project_service as proj_svc
from app.services import payment_service as pay_svc
from app.services import chat_service as chat_svc

# Заказчик, исполнитель, гостевой заказчик (read-only через project_viewers)
DEMO_PHONES = {"customer": "+70000000001", "contractor": "+70000000002", "guest": "+70000000003"}

# Канонические demo-чаты (уникальные названия)
APT_DEMO_CHATS = (
    "Общий чат объекта",
    "Согласование сметы",
    "Ванная: плитка и сантехника",
    "Оплата этапа «Электрика»",
)
HOUSE_DEMO_CHATS = ("Дом: общие вопросы",)

JUNK_TITLE_PREFIXES = (
    "walkthrough",
    "e2e",
    "k6",
    "uat",
    "аудит чат",
    "вопрос по смете",
    "вопрос по ремонту",
)


def _is_junk_title(title: str) -> bool:
    norm = chat_svc.normalize_chat_title(title)
    if not norm or norm == "чат":
        return True
    return any(norm.startswith(p) for p in JUNK_TITLE_PREFIXES)


async def _purge_project_chats(db: AsyncSession, project_id: str, allowed_titles: tuple[str, ...]) -> None:
    allowed = {chat_svc.normalize_chat_title(t) for t in allowed_titles}
    threads = await chat_svc.list_threads(db, project_id)
    seen: set[str] = set()
    for t in sorted(threads, key=lambda x: x.updated_at or datetime.min, reverse=True):
        norm = chat_svc.normalize_chat_title(t.title)
        if norm not in allowed or norm in seen or _is_junk_title(t.title):
            await chat_svc.delete_thread(db, t.id)
            continue
        seen.add(norm)
    await db.commit()


async def _non_system_count(db: AsyncSession, thread_id: str) -> int:
    t = await chat_svc.get_thread(db, thread_id)
    if not t:
        return 0
    return sum(1 for m in t.messages if m.message_type != ChatMessageType.system)


async def _ensure_thread(db: AsyncSession, project_id: str, user_id: str, title: str, topic: str):
    existing = await chat_svc.find_thread_by_title(db, project_id, title)
    if existing:
        return existing
    return await chat_svc.create_thread(db, project_id, user_id, title, topic)


async def _seed_apartment_chats(
    db: AsyncSession,
    project_id: str,
    customer_id: str,
    contractor_id: str,
) -> None:
    await _purge_project_chats(db, project_id, APT_DEMO_CHATS)

    t_general = await _ensure_thread(db, project_id, customer_id, APT_DEMO_CHATS[0], "general")
    t_estimate = await _ensure_thread(db, project_id, customer_id, APT_DEMO_CHATS[1], "estimate")
    t_bathroom = await _ensure_thread(db, project_id, customer_id, APT_DEMO_CHATS[2], "room:bathroom")
    t_payment = await _ensure_thread(db, project_id, customer_id, APT_DEMO_CHATS[3], "payment")

    t_est_check = await chat_svc.find_thread_by_title(db, project_id, APT_DEMO_CHATS[1])
    if t_est_check and await _non_system_count(db, t_est_check.id) >= 2:
        return

    m1 = await chat_svc.send_message(
        db,
        t_general,
        customer_id,
        "customer",
        "Добрый день! Когда можем начать демонтаж в гостиной?",
    )
    m2 = await chat_svc.send_message(
        db,
        t_general,
        contractor_id,
        "contractor",
        "Завтра с 10:00. Вынос мусора включён в смету.",
    )
    await chat_svc.send_message(
        db,
        t_general,
        customer_id,
        "customer",
        "Отлично, буду на объекте.",
        reply_to_id=m2.id,
    )
    await chat_svc.toggle_reaction(db, m2.id, customer_id, "👍")

    await chat_svc.send_message(
        db,
        t_estimate,
        customer_id,
        "customer",
        "По позиции «Штукатурка» — можно взять материал подешевле?",
    )
    await chat_svc.send_message(
        db,
        t_estimate,
        contractor_id,
        "contractor",
        "Можем GKL + шпаклёвка — минус ~8 000 ₽, но срок +2 дня.",
    )
    confirm = await chat_svc.send_message(
        db,
        t_estimate,
        contractor_id,
        "contractor",
        "Подтвердите замену материала в смете",
        "confirm",
    )
    await chat_svc.pin_message(db, confirm.id, True)

    await chat_svc.send_message(
        db,
        t_bathroom,
        customer_id,
        "customer",
        "Согласовали раскладку плитки в ванной — diagonal, фото на объекте.",
    )
    await chat_svc.send_message(
        db,
        t_bathroom,
        contractor_id,
        "contractor",
        "Принято. Закупаем клей Kerama, старт в четверг.",
    )
    bath_thread = await chat_svc.get_thread(db, t_bathroom.id)
    bath_reply = bath_thread.messages[-1] if bath_thread else None
    has_task = bath_thread and any(m.message_type == ChatMessageType.task for m in bath_thread.messages)
    if bath_reply and not has_task:
        await chat_svc.create_task_from_message(
            db,
            t_bathroom,
            contractor_id,
            "contractor",
            bath_reply.id,
            title="Укладка плитки в ванной",
            assignee_id=contractor_id,
            due_at=(date.today() + timedelta(days=5)).isoformat(),
            work_type="tiling",
        )

    pay_thread = await chat_svc.get_thread(db, t_payment.id)
    has_payment = pay_thread and any(m.message_type == ChatMessageType.payment for m in pay_thread.messages)
    if not has_payment:
        await chat_svc.create_payment_message(
            db,
            t_payment,
            contractor_id,
            "contractor",
            title="Электрика — этап 2",
            amount=45_000,
            payment_type="stage",
        )
        await chat_svc.send_message(
            db,
            t_payment,
            customer_id,
            "customer",
            "Перевёл на карту, проверьте, пожалуйста.",
        )
        await chat_svc.send_message(
            db,
            t_payment,
            contractor_id,
            "contractor",
            "Проверю поступление сегодня вечером.",
        )

    await chat_svc.set_thread_state(db, t_payment.id, customer_id, is_pinned=True)


async def _seed_house_chats(
    db: AsyncSession,
    project_id: str,
    customer_id: str,
    contractor_id: str,
) -> None:
    await _purge_project_chats(db, project_id, HOUSE_DEMO_CHATS)
    t = await _ensure_thread(db, project_id, customer_id, HOUSE_DEMO_CHATS[0], "general")
    if await _non_system_count(db, t.id) > 0:
        return
    await chat_svc.send_message(
        db,
        t,
        customer_id,
        "customer",
        "По дому: когда удобно приехать на замер террасы?",
    )
    await chat_svc.send_message(
        db,
        t,
        contractor_id,
        "contractor",
        "В субботу до обеда — напишите, если подходит.",
    )


async def _ensure_house_demo(db: AsyncSession, customer_id: str) -> None:
    r = await db.execute(select(Project).where(Project.customer_id == customer_id, Project.property_type == "house"))
    if r.scalar_one_or_none():
        return
    await proj_svc.create_project(
        db,
        customer_id=customer_id,
        name="Демо-дом, дачный посёлок",
        address="МО, д. Пример",
        renovation_type="capital",
        property_type="house",
        total_area_sqm=120,
        planned_start_date=date.today(),
        rooms_data=[
            {"name": "Гостиная", "room_type": "living", "floor_level": 1, "length_m": 5, "width_m": 4, "height_m": 2.8, "outlets_count": 8, "switches_count": 3, "plumbing_points": 0},
            {"name": "Кухня", "room_type": "kitchen", "floor_level": 1, "length_m": 4, "width_m": 3, "height_m": 2.8, "outlets_count": 6, "switches_count": 2, "plumbing_points": 3},
            {"name": "Санузел", "room_type": "bathroom", "floor_level": 1, "length_m": 2.5, "width_m": 2, "height_m": 2.8, "outlets_count": 2, "switches_count": 1, "plumbing_points": 5},
            {"name": "Спальня", "room_type": "bedroom", "floor_level": 2, "length_m": 4, "width_m": 3.5, "height_m": 2.5, "outlets_count": 4, "switches_count": 1, "plumbing_points": 0},
        ],
    )


async def _link_guest(db: AsyncSession, projects: list[Project]) -> None:
    rv = await db.execute(select(User).where(User.phone == DEMO_PHONES["guest"]))
    guest = rv.scalar_one_or_none()
    if not guest:
        return
    for proj in projects:
        ex = await db.execute(select(ProjectViewer).where(ProjectViewer.project_id == proj.id, ProjectViewer.user_id == guest.id))
        if not ex.scalar_one_or_none():
            db.add(ProjectViewer(project_id=proj.id, user_id=guest.id))
    await db.commit()


async def _seed_chats_for_customer_projects(
    db: AsyncSession,
    customer: User,
    contractor: User,
    projects: list[Project],
) -> None:
    for proj in projects:
        if proj.property_type == "house":
            await _seed_house_chats(db, proj.id, customer.id, contractor.id)
        else:
            await _seed_apartment_chats(db, proj.id, customer.id, contractor.id)


async def ensure_demo_users(db: AsyncSession) -> None:
    names = {"customer": "Демо заказчик", "contractor": "Демо исполнитель", "guest": "Демо гость (read-only)"}
    for key, phone in DEMO_PHONES.items():
        r = await db.execute(select(User).where(User.phone == phone))
        u = r.scalar_one_or_none()
        if not u:
            db.add(
                User(
                    phone=phone,
                    role=UserRole.customer if key != "contractor" else UserRole.contractor,
                    full_name=names[key],
                    inn="000000000000" if key == "contractor" else None,
                )
            )
        elif key == "guest" and u.role != UserRole.customer:
            u.role = UserRole.customer
    await db.commit()

    r = await db.execute(select(User).where(User.phone == DEMO_PHONES["customer"]))
    customer = r.scalar_one()
    rc = await db.execute(select(User).where(User.phone == DEMO_PHONES["contractor"]))
    contractor = rc.scalar_one()

    r2 = await db.execute(select(Project).where(Project.customer_id == customer.id))
    existing_projects = list(r2.scalars().all())
    if existing_projects:
        await _ensure_house_demo(db, customer.id)
        r2 = await db.execute(select(Project).where(Project.customer_id == customer.id))
        existing_projects = list(r2.scalars().all())
        await _seed_chats_for_customer_projects(db, customer, contractor, existing_projects)
        await _link_guest(db, existing_projects)
        return

    p = await proj_svc.create_project(
        db,
        customer_id=customer.id,
        name="Демо-квартира, ул. Пример 12",
        address="Москва, ул. Пример 12",
        renovation_type="cosmetic",
        property_type="apartment",
        total_area_sqm=52,
        planned_start_date=date.today(),
        rooms_data=[
            {"name": "Гостиная", "room_type": "living", "length_m": 4.2, "width_m": 3.1, "height_m": 2.7, "outlets_count": 6, "switches_count": 2, "plumbing_points": 0},
            {"name": "Спальня", "room_type": "bedroom", "length_m": 3.5, "width_m": 3.0, "height_m": 2.7, "outlets_count": 4, "switches_count": 1, "plumbing_points": 0},
            {"name": "Ванная", "room_type": "bathroom", "length_m": 2.2, "width_m": 1.8, "height_m": 2.7, "outlets_count": 2, "switches_count": 1, "plumbing_points": 4},
        ],
    )
    await pay_svc.create_payment(db, p.id, customer.id, "Аванс 30%", round(p.budget_planned * 0.3, 2), "advance", notes="Демо: подтвердите оплату на вкладке Финансы")
    await _seed_apartment_chats(db, p.id, customer.id, contractor.id)
    await _link_guest(db, [p])
