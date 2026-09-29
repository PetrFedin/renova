"""Regression proof for #319 follow-up: the full project-owned FK subgraph
must cascade (or SET NULL) cleanly on purge/empty_trash, and the
project_documents legal_hold compliance gate must survive the cascade.

w23participantpurgecascade01 fixed only project_participants/_scopes/_events.
w24projectpurgecascade01 fixes the other 92 foreign keys inside the
project-owned subtree (see that migration's docstring for the full audit).
This test builds one project with a representative slice of every table in
that subtree — including the tricky self-referencing / diamond-shaped edges
(stages.depends_on_stage_id, chat_messages.reply_to_id,
project_work_schedule_items.depends_on_item_id,
project_technical_supervisor_assignments.supersedes_assignment_id,
purchase_items.material_pick_id, work_dependencies.depends_on_*) — and proves
against a real PostgreSQL database that purge_project() and empty_trash()
both complete without IntegrityError/ForeignKeyViolationError and leave zero
orphaned rows.
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
import app.models.project_documents  # noqa: F401
import app.models.webhook_runtime  # noqa: F401
from app.models.calendar import CalendarItem
from app.models.entities import (
    ActivityEvent,
    AppNotification,
    BudgetAlertSent,
    BudgetLine,
    ChangeOrder,
    ChatMessage,
    ChatThread,
    CommentReaction,
    DesignPackage,
    EstimateLine,
    Expense,
    FloorPlan,
    FloorPlanPin,
    FurnitureItem,
    MarginSnapshot,
    MaterialPick,
    NotificationType,
    Payment,
    PaymentEvent,
    PaymentType,
    Project,
    ProjectChecklistTemplate,
    ProjectIssue,
    ProjectViewer,
    Purchase,
    PurchaseItem,
    Receipt,
    Room,
    RoomChangeLog,
    RoomChangeRequest,
    ScratchpadLine,
    SelectionItem,
    Stage,
    StageComment,
    StagePhoto,
    Supplier,
    User,
    UserRole,
    WasteOrder,
    WorkAcceptance,
    WorkDependency,
    WorkOrder,
    PropertyFloor,
    PropertyObject,
)
from app.models.payment_evidence import PaymentEvidence
from app.models.project_documents import DocumentSignature, DocumentVersion, ProjectDocument
from app.models.technical_supervision import ProjectTechnicalSupervisorAssignment
from app.models.work_schedule import ProjectWorkSchedule, ProjectWorkScheduleItem
from app.services import project_service

ALL_CHILD_MODELS = [
    Room, EstimateLine, Stage, StageComment, StagePhoto, Payment, ChangeOrder, Receipt,
    ProjectViewer, RoomChangeRequest, ChatThread, ChatMessage, AppNotification, WorkOrder,
    ScratchpadLine, BudgetAlertSent, CommentReaction, RoomChangeLog, MarginSnapshot,
    ProjectChecklistTemplate, Supplier, Purchase, PurchaseItem, MaterialPick, SelectionItem,
    ActivityEvent, FloorPlan, FloorPlanPin, WasteOrder, FurnitureItem, DesignPackage,
    ProjectIssue, WorkDependency, PropertyFloor, PropertyObject, WorkAcceptance, BudgetLine,
    Expense, CalendarItem, PaymentEvent, PaymentEvidence, ProjectDocument, DocumentVersion,
    DocumentSignature, ProjectWorkSchedule, ProjectWorkScheduleItem,
    ProjectTechnicalSupervisorAssignment,
]


def _uuid() -> str:
    return str(uuid.uuid4())


def _user(role=UserRole.customer) -> User:
    token = uuid.uuid4()
    return User(id=str(token), phone=f"+7{token.int % 10**10:010d}", role=role)


async def _build_full_project_graph(db, *, legal_hold: bool = False):
    """Populate one project with a representative slice of the whole
    project-owned FK subgraph, including its self-referencing/diamond edges."""
    owner = _user()
    db.add(owner)
    await db.flush()

    project = Project(id=_uuid(), name="Full graph", customer_id=owner.id, renovation_type="cosmetic")
    db.add(project)
    await db.flush()

    floor = PropertyFloor(id=_uuid(), project_id=project.id, name="1st floor")
    db.add(floor)
    await db.flush()
    prop_object = PropertyObject(id=_uuid(), project_id=project.id)

    room = Room(id=_uuid(), project_id=project.id, floor_id=floor.id, name="Living room", length_m=4, width_m=3)
    db.add(room)
    await db.flush()

    stage_a = Stage(id=_uuid(), project_id=project.id, name="Demolition", sort_order=0)
    db.add(stage_a)
    await db.flush()
    stage_b = Stage(id=_uuid(), project_id=project.id, name="Finishing", sort_order=1, depends_on_stage_id=stage_a.id)
    db.add(stage_b)
    await db.flush()

    stage_comment = StageComment(id=_uuid(), stage_id=stage_a.id, user_id=owner.id, author_role="customer", text="ok")
    db.add(stage_comment)
    await db.flush()
    stage_photo = StagePhoto(id=_uuid(), stage_id=stage_a.id, user_id=owner.id)
    reaction = CommentReaction(id=_uuid(), comment_id=stage_comment.id, user_id=owner.id, reaction="👍")

    payment = Payment(
        id=_uuid(), project_id=project.id, stage_id=stage_a.id, payment_type=PaymentType.stage,
        title="Advance", amount=1000, created_by=owner.id,
    )
    db.add(payment)
    await db.flush()

    receipt = Receipt(id=_uuid(), project_id=project.id, room_id=room.id, stage_id=stage_a.id, payment_id=payment.id, amount=1000)
    db.add(receipt)
    await db.flush()

    expense = Expense(
        id=_uuid(), project_id=project.id, room_id=room.id, stage_id=stage_a.id,
        receipt_id=receipt.id, payment_id=payment.id, title="Cement", amount=500,
    )
    payment_event = PaymentEvent(id=_uuid(), payment_id=payment.id, source="manual", new_status="confirmed")
    payment_evidence = PaymentEvidence(
        id=_uuid(), project_id=project.id, payment_id=payment.id, version=1,
        storage_key=f"evidence/{_uuid()}", original_filename="proof.png",
        declared_content_type="image/png", submitted_by=owner.id,
    )

    change_order = ChangeOrder(id=_uuid(), project_id=project.id, title="Extra tiling", amount=200, created_by=owner.id)

    document = ProjectDocument(id=_uuid(), project_id=project.id, stage_id=stage_a.id, payment_id=payment.id, title="Contract")
    db.add(document)
    await db.flush()
    document_version = DocumentVersion(id=_uuid(), document_id=document.id, version_number=1)
    db.add(document_version)
    await db.flush()
    document_signature = DocumentSignature(id=_uuid(), document_id=document.id, version_id=document_version.id, signer_user_id=owner.id)
    if legal_hold:
        document.legal_hold = True

    thread = ChatThread(id=_uuid(), project_id=project.id, title="General", created_by=owner.id)
    db.add(thread)
    await db.flush()
    message_a = ChatMessage(id=_uuid(), thread_id=thread.id, user_id=owner.id, author_role="customer", text="hi")
    db.add(message_a)
    await db.flush()
    message_b = ChatMessage(id=_uuid(), thread_id=thread.id, user_id=owner.id, author_role="customer", text="reply", reply_to_id=message_a.id)

    work_order = WorkOrder(
        id=_uuid(), project_id=project.id, room_id=room.id, stage_id=stage_a.id,
        chat_thread_id=thread.id, work_type="electrical", title="Wiring",
    )

    work_acceptance = WorkAcceptance(id=_uuid(), project_id=project.id, room_id=room.id, stage_id=stage_a.id)

    supplier = Supplier(id=_uuid(), project_id=project.id, name="BuildCo")
    db.add(supplier)
    await db.flush()
    material_pick = MaterialPick(id=_uuid(), project_id=project.id, room_id=room.id, name="Tiles")
    db.add(material_pick)
    await db.flush()
    purchase = Purchase(id=_uuid(), project_id=project.id, supplier_id=supplier.id)
    db.add(purchase)
    await db.flush()
    purchase_item = PurchaseItem(id=_uuid(), purchase_id=purchase.id, material_pick_id=material_pick.id, name="Tiles box")

    work_dependency = WorkDependency(
        id=_uuid(), project_id=project.id, stage_id=stage_b.id,
        depends_on_stage_id=stage_a.id, depends_on_material_pick_id=material_pick.id,
    )

    floor_plan = FloorPlan(id=_uuid(), project_id=project.id, image_key="plan.png")
    db.add(floor_plan)
    await db.flush()
    floor_plan_pin = FloorPlanPin(id=_uuid(), floor_plan_id=floor_plan.id, room_id=room.id)
    furniture_item = FurnitureItem(id=_uuid(), project_id=project.id, room_id=room.id, floor_plan_id=floor_plan.id, name="Sofa")

    schedule = ProjectWorkSchedule(id=_uuid(), project_id=project.id, created_by=owner.id)
    db.add(schedule)
    await db.flush()
    item_a = ProjectWorkScheduleItem(
        id=_uuid(), schedule_id=schedule.id, project_id=project.id, stage_id=stage_a.id,
        title="Demo walls", planned_start_date=date(2026, 1, 1), planned_finish_date=date(2026, 1, 5),
    )
    db.add(item_a)
    await db.flush()
    item_b = ProjectWorkScheduleItem(
        id=_uuid(), schedule_id=schedule.id, project_id=project.id, stage_id=stage_b.id,
        title="Finish walls", planned_start_date=date(2026, 1, 6), planned_finish_date=date(2026, 1, 10),
        depends_on_item_id=item_a.id,
    )

    supervisor_a = ProjectTechnicalSupervisorAssignment(
        id=_uuid(), project_id=project.id, representative_user_id=owner.id,
        provider_type="individual", provider_name="Ivanov", appointed_by_user_id=owner.id,
        revoked_at=datetime(2026, 1, 1), revoked_by_user_id=owner.id,
    )
    db.add(supervisor_a)
    await db.flush()
    supervisor_b = ProjectTechnicalSupervisorAssignment(
        id=_uuid(), project_id=project.id, representative_user_id=owner.id,
        provider_type="individual", provider_name="Petrov", appointed_by_user_id=owner.id,
        supersedes_assignment_id=supervisor_a.id,
    )

    selection_item = SelectionItem(id=_uuid(), project_id=project.id, room_id=room.id, title="Faucet")
    waste_order = WasteOrder(id=_uuid(), project_id=project.id, room_id=room.id)
    room_change_request = RoomChangeRequest(id=_uuid(), project_id=project.id, room_id=room.id, requested_by=owner.id, message="resize")
    room_change_log = RoomChangeLog(id=_uuid(), room_id=room.id, user_id=owner.id, field_name="name", old_value="A", new_value="B")
    budget_alert = BudgetAlertSent(id=_uuid(), user_id=owner.id, room_id=room.id, sent_date="2026-01-01")
    scratchpad_line = ScratchpadLine(id=_uuid(), project_id=project.id, text="buy tiles", created_by=owner.id)
    project_issue = ProjectIssue(id=_uuid(), project_id=project.id, room_id=room.id, stage_id=stage_a.id, floor_plan_id=floor_plan.id, title="Crack")
    budget_line = BudgetLine(id=_uuid(), project_id=project.id, room_id=room.id, stage_id=stage_a.id, description="Materials")
    calendar_item = CalendarItem(
        id=_uuid(), user_id=owner.id, project_id=project.id, stage_id=stage_a.id, title="Inspection",
        start_at=datetime(2026, 1, 1, 10, 0, 0), end_at=datetime(2026, 1, 1, 11, 0, 0),
    )
    app_notification = AppNotification(id=_uuid(), user_id=owner.id, project_id=project.id, notification_type=NotificationType.other, title="Hi", body="Body")
    activity_event = ActivityEvent(id=_uuid(), project_id=project.id, kind="note", title="Created")
    margin_snapshot = MarginSnapshot(id=_uuid(), project_id=project.id)
    checklist_template = ProjectChecklistTemplate(id=_uuid(), project_id=project.id, name="Std", items_json="[]")
    project_viewer = ProjectViewer(id=_uuid(), project_id=project.id, user_id=owner.id)
    design_package = DesignPackage(id=_uuid(), project_id=project.id, title="Concept v1")

    db.add_all([
        prop_object, stage_photo, reaction, expense, payment_event, payment_evidence,
        change_order, document_signature, message_b, work_order, work_acceptance, purchase_item,
        work_dependency, floor_plan_pin, furniture_item, item_b, supervisor_b, selection_item,
        waste_order, room_change_request, room_change_log, budget_alert, scratchpad_line,
        project_issue, budget_line, calendar_item, app_notification, activity_event, margin_snapshot,
        checklist_template, project_viewer, design_package,
    ])
    await db.commit()
    return owner, project


def _postgres_session():
    url = os.environ.get("PROJECT_PARTICIPANT_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("Dedicated PostgreSQL workflow only")
    assert url.startswith("postgresql+asyncpg://"), "cascade proof must use real PostgreSQL"
    engine = create_async_engine(url)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _count(db, model, **filters) -> int:
    stmt = select(func.count()).select_from(model)
    for key, value in filters.items():
        stmt = stmt.where(getattr(model, key) == value)
    return await db.scalar(stmt)


@pytest.mark.asyncio
async def test_postgres_purge_project_clears_full_fk_subgraph_without_integrity_error():
    """w24projectpurgecascade01 regression proof: purge_project() must not
    raise ForeignKeyViolationError for a project with the full breadth of
    project-owned child data, and must leave zero orphans anywhere."""
    engine, Session = _postgres_session()
    try:
        async with Session() as db:
            owner, project = await _build_full_project_graph(db)
            owner_id, project_id = owner.id, project.id

        async with Session() as db:
            await project_service.trash_project(db, project_id, owner)

        async with Session() as db:
            fresh_owner = await db.get(User, owner_id)
            # Must complete without IntegrityError/ForeignKeyViolationError.
            await project_service.purge_project(db, project_id, fresh_owner)

        async with Session() as db:
            assert await _count(db, Project, id=project_id) == 0
            for model in ALL_CHILD_MODELS:
                if model is ProjectDocument:
                    assert await _count(db, model, project_id=project_id) == 0
                elif hasattr(model, "project_id"):
                    assert await _count(db, model, project_id=project_id) == 0
            # spot-check the deepest / self-referencing rows specifically
            assert await _count(db, StageComment) == 0
            assert await _count(db, ChatMessage) == 0
            assert await _count(db, PurchaseItem) == 0
            assert await _count(db, DocumentVersion) == 0
            assert await _count(db, DocumentSignature) == 0
            assert await _count(db, ProjectWorkScheduleItem) == 0
            assert await _count(db, ProjectTechnicalSupervisorAssignment) == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_postgres_empty_trash_bulk_delete_clears_full_fk_subgraph():
    """Same proof for empty_trash()'s bulk ``DELETE FROM projects`` path,
    which bypasses ORM relationship cascades entirely and depends solely on
    the DB-level ON DELETE actions from w24projectpurgecascade01."""
    engine, Session = _postgres_session()
    try:
        async with Session() as db:
            owner, project = await _build_full_project_graph(db)
            owner_id, project_id = owner.id, project.id

        async with Session() as db:
            fresh_owner = await db.get(User, owner_id)
            await project_service.trash_project(db, project_id, fresh_owner)

        async with Session() as db:
            fresh_owner = await db.get(User, owner_id)
            deleted = await project_service.empty_trash(db, fresh_owner)
            assert deleted == 1

        async with Session() as db:
            assert await _count(db, Project, id=project_id) == 0
            assert await _count(db, Stage, project_id=project_id) == 0
            assert await _count(db, ChatMessage) == 0
            assert await _count(db, WorkDependency, project_id=project_id) == 0
            assert await _count(db, ProjectDocument, project_id=project_id) == 0
            assert await _count(db, DocumentVersion) == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_postgres_purge_project_blocked_by_legal_hold_document():
    """The one deliberately-NOT-cascaded edge: project_documents.project_id.
    A project with a legal_hold document must not be purgeable at all, and
    the attempt must not have deleted anything (fail closed, not partial)."""
    engine, Session = _postgres_session()
    try:
        async with Session() as db:
            owner, project = await _build_full_project_graph(db, legal_hold=True)
            owner_id, project_id = owner.id, project.id

        async with Session() as db:
            await project_service.trash_project(db, project_id, owner)

        async with Session() as db:
            fresh_owner = await db.get(User, owner_id)
            with pytest.raises(ValueError, match="legal_hold_blocks_purge"):
                await project_service.purge_project(db, project_id, fresh_owner)

        async with Session() as db:
            assert await _count(db, Project, id=project_id) == 1
            assert await _count(db, ProjectDocument, project_id=project_id) == 1
            assert await _count(db, Stage, project_id=project_id) == 2
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_postgres_empty_trash_skips_legal_held_project_but_purges_others():
    """empty_trash() has no per-project error channel back to the caller —
    it must silently skip a legal-held project while still purging the
    customer's other trashed projects, and report only what it actually
    deleted."""
    engine, Session = _postgres_session()
    try:
        async with Session() as db:
            owner, held_project = await _build_full_project_graph(db, legal_hold=True)
            owner_id, held_id = owner.id, held_project.id
            _, clean_project = await _build_full_project_graph(db)
            clean_id = clean_project.id
            # second project belongs to the same owner: force it in code below
        async with Session() as db:
            from sqlalchemy import update
            await db.execute(update(Project).where(Project.id == clean_id).values(customer_id=owner_id))
            await db.commit()

        async with Session() as db:
            fresh_owner = await db.get(User, owner_id)
            await project_service.trash_project(db, held_id, fresh_owner)
        async with Session() as db:
            fresh_owner = await db.get(User, owner_id)
            await project_service.trash_project(db, clean_id, fresh_owner)

        async with Session() as db:
            fresh_owner = await db.get(User, owner_id)
            deleted = await project_service.empty_trash(db, fresh_owner)
            assert deleted == 1

        async with Session() as db:
            assert await _count(db, Project, id=held_id) == 1
            assert await _count(db, ProjectDocument, project_id=held_id) == 1
            assert await _count(db, Project, id=clean_id) == 0
            assert await _count(db, ProjectDocument, project_id=clean_id) == 0
    finally:
        await engine.dispose()
