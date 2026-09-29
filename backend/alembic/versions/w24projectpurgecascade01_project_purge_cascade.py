"""Cascade the full project-owned FK subgraph for purge/empty_trash

Issue #319 (follow-up audit): w23participantpurgecascade01 fixed the
project_participants/_scopes/_events graph, but a full FK-graph audit from
``projects`` down (BFS over information_schema, cross-checked against the
live schema) found 92 more foreign keys inside the project-owned subtree
still defaulting to ``ON DELETE NO ACTION``. Any of them blocks
project_service.purge_project() (ORM ``db.delete(project)``) and
project_service.empty_trash() (bulk ``DELETE FROM projects``) the same way
the participant graph did — reproduced against a real PostgreSQL database
for stages (``stages_project_id_fkey``) and confirmed structurally for the
rest via the FK graph dump (information_schema, BFS from ``projects``).

Two kinds of edge in the subgraph are handled differently:

* Strict containment (the child row has no meaning without its parent —
  every ``project_id`` column, plus columns like ``thread_id``,
  ``purchase_id``, ``schedule_id``, ``participant_id`` that name a row's one
  true owner) gets ON DELETE CASCADE, so the row disappears with its owner.
  ``project_id`` columns get CASCADE unconditionally, including the two that
  happen to be nullable (``app_notifications``, ``calendar_items``) — they
  are still each row's primary ownership link, not a secondary reference.
* Soft/dependency references between sibling rows under the same project
  (``depends_on_*``, ``supersedes_*``, ``reply_to_id``, and nullable
  cross-links such as ``budget_lines.room_id`` or ``purchases.supplier_id``)
  get ON DELETE SET NULL instead. These are nullable references, not
  ownership, and the target is already being removed via its own cascade
  path — CASCADE here would risk deleting unrelated rows purely because
  something they *reference* (not something that owns them) was removed,
  and would make the outcome depend on trigger-firing order across the
  diamond-shaped parts of this graph.

Deliberately NOT cascaded: ``project_documents.project_id``. ProjectDocument
already has an application-level compliance gate (legal_hold /
retention_until — see project_document_service.soft_delete_document, which
raises ``legal_hold_blocks_delete``) that a DB-level CASCADE would silently
bypass: a bulk ``DELETE FROM projects`` would destroy legally-held documents
regardless of that flag. project_service now checks for legal_hold documents
before purging a project and explicitly deletes the (ungated) document rows
itself; the DB constraint stays NO ACTION as a backstop. document_versions
and document_signatures — which sit *under* project_documents and carry no
hold flag of their own — do get CASCADE, since they only disappear once
their parent document has already passed that gate.

``audit_logs`` and ``domain_outbox`` (mentioned in the issue as example
compliance-sensitive tables) were checked and have no foreign key to
projects at all — aggregate_id / user_id there are plain, unconstrained
columns — so no schema change was needed for them.

Tables touched: activity_events, app_notifications, budget_alert_sent, budget_lines, calendar_items, change_orders, chat_messages, chat_thread_participants, chat_thread_reads, chat_threads, comment_reactions, design_packages, document_signatures, document_versions, estimate_lines, expenses, floor_plan_pins, floor_plans, furniture_items, margin_snapshots, material_picks, payment_events, payment_evidence, payments, project_checklist_templates, project_documents, project_issues, project_technical_supervisor_assignments, project_viewers, project_work_schedule_items, project_work_schedules, property_floors, property_objects, purchase_items, purchases, receipts, room_change_logs, room_change_requests, rooms, scratchpad_lines, selection_items, stage_comments, stage_photos, stages, suppliers, waste_orders, work_acceptances, work_dependencies, work_orders

Revision ID: w24projectpurgecascade01
Revises: w23participantpurgecascade01
Create Date: 2026-09-29
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "w24projectpurgecascade01"
down_revision: str | None = "w23participantpurgecascade01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("activity_events_project_id_fkey", "activity_events", type_="foreignkey")
    op.create_foreign_key(
        "activity_events_project_id_fkey",
        "activity_events",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("app_notifications_project_id_fkey", "app_notifications", type_="foreignkey")
    op.create_foreign_key(
        "app_notifications_project_id_fkey",
        "app_notifications",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("budget_alert_sent_room_id_fkey", "budget_alert_sent", type_="foreignkey")
    op.create_foreign_key(
        "budget_alert_sent_room_id_fkey",
        "budget_alert_sent",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("budget_lines_estimate_line_id_fkey", "budget_lines", type_="foreignkey")
    op.create_foreign_key(
        "budget_lines_estimate_line_id_fkey",
        "budget_lines",
        "estimate_lines",
        ["estimate_line_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("budget_lines_project_id_fkey", "budget_lines", type_="foreignkey")
    op.create_foreign_key(
        "budget_lines_project_id_fkey",
        "budget_lines",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("budget_lines_room_id_fkey", "budget_lines", type_="foreignkey")
    op.create_foreign_key(
        "budget_lines_room_id_fkey",
        "budget_lines",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("budget_lines_stage_id_fkey", "budget_lines", type_="foreignkey")
    op.create_foreign_key(
        "budget_lines_stage_id_fkey",
        "budget_lines",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("fk_calendar_items_project_id_projects", "calendar_items", type_="foreignkey")
    op.create_foreign_key(
        "fk_calendar_items_project_id_projects",
        "calendar_items",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("fk_calendar_items_stage_id_stages", "calendar_items", type_="foreignkey")
    op.create_foreign_key(
        "fk_calendar_items_stage_id_stages",
        "calendar_items",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("change_orders_project_id_fkey", "change_orders", type_="foreignkey")
    op.create_foreign_key(
        "change_orders_project_id_fkey",
        "change_orders",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("chat_messages_reply_to_id_fkey", "chat_messages", type_="foreignkey")
    op.create_foreign_key(
        "chat_messages_reply_to_id_fkey",
        "chat_messages",
        "chat_messages",
        ["reply_to_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("chat_messages_thread_id_fkey", "chat_messages", type_="foreignkey")
    op.create_foreign_key(
        "chat_messages_thread_id_fkey",
        "chat_messages",
        "chat_threads",
        ["thread_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("chat_thread_participants_thread_id_fkey", "chat_thread_participants", type_="foreignkey")
    op.create_foreign_key(
        "chat_thread_participants_thread_id_fkey",
        "chat_thread_participants",
        "chat_threads",
        ["thread_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("chat_thread_reads_thread_id_fkey", "chat_thread_reads", type_="foreignkey")
    op.create_foreign_key(
        "chat_thread_reads_thread_id_fkey",
        "chat_thread_reads",
        "chat_threads",
        ["thread_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("chat_threads_project_id_fkey", "chat_threads", type_="foreignkey")
    op.create_foreign_key(
        "chat_threads_project_id_fkey",
        "chat_threads",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("comment_reactions_comment_id_fkey", "comment_reactions", type_="foreignkey")
    op.create_foreign_key(
        "comment_reactions_comment_id_fkey",
        "comment_reactions",
        "stage_comments",
        ["comment_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("design_packages_project_id_fkey", "design_packages", type_="foreignkey")
    op.create_foreign_key(
        "design_packages_project_id_fkey",
        "design_packages",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("document_signatures_document_id_fkey", "document_signatures", type_="foreignkey")
    op.create_foreign_key(
        "document_signatures_document_id_fkey",
        "document_signatures",
        "project_documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("document_signatures_version_id_fkey", "document_signatures", type_="foreignkey")
    op.create_foreign_key(
        "document_signatures_version_id_fkey",
        "document_signatures",
        "document_versions",
        ["version_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("document_versions_document_id_fkey", "document_versions", type_="foreignkey")
    op.create_foreign_key(
        "document_versions_document_id_fkey",
        "document_versions",
        "project_documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("estimate_lines_project_id_fkey", "estimate_lines", type_="foreignkey")
    op.create_foreign_key(
        "estimate_lines_project_id_fkey",
        "estimate_lines",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("estimate_lines_room_id_fkey", "estimate_lines", type_="foreignkey")
    op.create_foreign_key(
        "estimate_lines_room_id_fkey",
        "estimate_lines",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("expenses_payment_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_payment_id_fkey",
        "expenses",
        "payments",
        ["payment_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("expenses_project_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_project_id_fkey",
        "expenses",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("expenses_receipt_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_receipt_id_fkey",
        "expenses",
        "receipts",
        ["receipt_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("expenses_room_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_room_id_fkey",
        "expenses",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("expenses_stage_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_stage_id_fkey",
        "expenses",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("floor_plan_pins_floor_plan_id_fkey", "floor_plan_pins", type_="foreignkey")
    op.create_foreign_key(
        "floor_plan_pins_floor_plan_id_fkey",
        "floor_plan_pins",
        "floor_plans",
        ["floor_plan_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("floor_plan_pins_room_id_fkey", "floor_plan_pins", type_="foreignkey")
    op.create_foreign_key(
        "floor_plan_pins_room_id_fkey",
        "floor_plan_pins",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("floor_plans_project_id_fkey", "floor_plans", type_="foreignkey")
    op.create_foreign_key(
        "floor_plans_project_id_fkey",
        "floor_plans",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("furniture_items_floor_plan_id_fkey", "furniture_items", type_="foreignkey")
    op.create_foreign_key(
        "furniture_items_floor_plan_id_fkey",
        "furniture_items",
        "floor_plans",
        ["floor_plan_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("furniture_items_project_id_fkey", "furniture_items", type_="foreignkey")
    op.create_foreign_key(
        "furniture_items_project_id_fkey",
        "furniture_items",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("furniture_items_room_id_fkey", "furniture_items", type_="foreignkey")
    op.create_foreign_key(
        "furniture_items_room_id_fkey",
        "furniture_items",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("margin_snapshots_project_id_fkey", "margin_snapshots", type_="foreignkey")
    op.create_foreign_key(
        "margin_snapshots_project_id_fkey",
        "margin_snapshots",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("material_picks_project_id_fkey", "material_picks", type_="foreignkey")
    op.create_foreign_key(
        "material_picks_project_id_fkey",
        "material_picks",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("material_picks_room_id_fkey", "material_picks", type_="foreignkey")
    op.create_foreign_key(
        "material_picks_room_id_fkey",
        "material_picks",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("payment_events_payment_id_fkey", "payment_events", type_="foreignkey")
    op.create_foreign_key(
        "payment_events_payment_id_fkey",
        "payment_events",
        "payments",
        ["payment_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("payment_evidence_payment_id_fkey", "payment_evidence", type_="foreignkey")
    op.create_foreign_key(
        "payment_evidence_payment_id_fkey",
        "payment_evidence",
        "payments",
        ["payment_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("payment_evidence_project_id_fkey", "payment_evidence", type_="foreignkey")
    op.create_foreign_key(
        "payment_evidence_project_id_fkey",
        "payment_evidence",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("payments_project_id_fkey", "payments", type_="foreignkey")
    op.create_foreign_key(
        "payments_project_id_fkey",
        "payments",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("payments_stage_id_fkey", "payments", type_="foreignkey")
    op.create_foreign_key(
        "payments_stage_id_fkey",
        "payments",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_checklist_templates_project_id_fkey", "project_checklist_templates", type_="foreignkey")
    op.create_foreign_key(
        "project_checklist_templates_project_id_fkey",
        "project_checklist_templates",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("project_documents_payment_id_fkey", "project_documents", type_="foreignkey")
    op.create_foreign_key(
        "project_documents_payment_id_fkey",
        "project_documents",
        "payments",
        ["payment_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_documents_receipt_id_fkey", "project_documents", type_="foreignkey")
    op.create_foreign_key(
        "project_documents_receipt_id_fkey",
        "project_documents",
        "receipts",
        ["receipt_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_documents_stage_id_fkey", "project_documents", type_="foreignkey")
    op.create_foreign_key(
        "project_documents_stage_id_fkey",
        "project_documents",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_documents_work_acceptance_id_fkey", "project_documents", type_="foreignkey")
    op.create_foreign_key(
        "project_documents_work_acceptance_id_fkey",
        "project_documents",
        "work_acceptances",
        ["work_acceptance_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_issues_floor_plan_id_fkey", "project_issues", type_="foreignkey")
    op.create_foreign_key(
        "project_issues_floor_plan_id_fkey",
        "project_issues",
        "floor_plans",
        ["floor_plan_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_issues_project_id_fkey", "project_issues", type_="foreignkey")
    op.create_foreign_key(
        "project_issues_project_id_fkey",
        "project_issues",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("project_issues_room_id_fkey", "project_issues", type_="foreignkey")
    op.create_foreign_key(
        "project_issues_room_id_fkey",
        "project_issues",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_issues_stage_id_fkey", "project_issues", type_="foreignkey")
    op.create_foreign_key(
        "project_issues_stage_id_fkey",
        "project_issues",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_technical_supervisor_assi_supersedes_assignment_id_fkey", "project_technical_supervisor_assignments", type_="foreignkey")
    op.create_foreign_key(
        "project_technical_supervisor_assi_supersedes_assignment_id_fkey",
        "project_technical_supervisor_assignments",
        "project_technical_supervisor_assignments",
        ["supersedes_assignment_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_viewers_project_id_fkey", "project_viewers", type_="foreignkey")
    op.create_foreign_key(
        "project_viewers_project_id_fkey",
        "project_viewers",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("project_work_schedule_items_depends_on_item_id_fkey", "project_work_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedule_items_depends_on_item_id_fkey",
        "project_work_schedule_items",
        "project_work_schedule_items",
        ["depends_on_item_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_work_schedule_items_project_id_fkey", "project_work_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedule_items_project_id_fkey",
        "project_work_schedule_items",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("project_work_schedule_items_schedule_id_fkey", "project_work_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedule_items_schedule_id_fkey",
        "project_work_schedule_items",
        "project_work_schedules",
        ["schedule_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("project_work_schedule_items_stage_id_fkey", "project_work_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedule_items_stage_id_fkey",
        "project_work_schedule_items",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("project_work_schedules_project_id_fkey", "project_work_schedules", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedules_project_id_fkey",
        "project_work_schedules",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("project_work_schedules_supersedes_id_fkey", "project_work_schedules", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedules_supersedes_id_fkey",
        "project_work_schedules",
        "project_work_schedules",
        ["supersedes_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("property_floors_project_id_fkey", "property_floors", type_="foreignkey")
    op.create_foreign_key(
        "property_floors_project_id_fkey",
        "property_floors",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("property_objects_project_id_fkey", "property_objects", type_="foreignkey")
    op.create_foreign_key(
        "property_objects_project_id_fkey",
        "property_objects",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("purchase_items_material_pick_id_fkey", "purchase_items", type_="foreignkey")
    op.create_foreign_key(
        "purchase_items_material_pick_id_fkey",
        "purchase_items",
        "material_picks",
        ["material_pick_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("purchase_items_purchase_id_fkey", "purchase_items", type_="foreignkey")
    op.create_foreign_key(
        "purchase_items_purchase_id_fkey",
        "purchase_items",
        "purchases",
        ["purchase_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("purchases_project_id_fkey", "purchases", type_="foreignkey")
    op.create_foreign_key(
        "purchases_project_id_fkey",
        "purchases",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("purchases_supplier_id_fkey", "purchases", type_="foreignkey")
    op.create_foreign_key(
        "purchases_supplier_id_fkey",
        "purchases",
        "suppliers",
        ["supplier_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("receipts_payment_id_fkey", "receipts", type_="foreignkey")
    op.create_foreign_key(
        "receipts_payment_id_fkey",
        "receipts",
        "payments",
        ["payment_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("receipts_project_id_fkey", "receipts", type_="foreignkey")
    op.create_foreign_key(
        "receipts_project_id_fkey",
        "receipts",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("room_change_logs_room_id_fkey", "room_change_logs", type_="foreignkey")
    op.create_foreign_key(
        "room_change_logs_room_id_fkey",
        "room_change_logs",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("room_change_requests_project_id_fkey", "room_change_requests", type_="foreignkey")
    op.create_foreign_key(
        "room_change_requests_project_id_fkey",
        "room_change_requests",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("room_change_requests_room_id_fkey", "room_change_requests", type_="foreignkey")
    op.create_foreign_key(
        "room_change_requests_room_id_fkey",
        "room_change_requests",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("fk_rooms_floor_id_property_floors", "rooms", type_="foreignkey")
    op.create_foreign_key(
        "fk_rooms_floor_id_property_floors",
        "rooms",
        "property_floors",
        ["floor_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("rooms_project_id_fkey", "rooms", type_="foreignkey")
    op.create_foreign_key(
        "rooms_project_id_fkey",
        "rooms",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("scratchpad_lines_project_id_fkey", "scratchpad_lines", type_="foreignkey")
    op.create_foreign_key(
        "scratchpad_lines_project_id_fkey",
        "scratchpad_lines",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("selection_items_project_id_fkey", "selection_items", type_="foreignkey")
    op.create_foreign_key(
        "selection_items_project_id_fkey",
        "selection_items",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("selection_items_room_id_fkey", "selection_items", type_="foreignkey")
    op.create_foreign_key(
        "selection_items_room_id_fkey",
        "selection_items",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("stage_comments_stage_id_fkey", "stage_comments", type_="foreignkey")
    op.create_foreign_key(
        "stage_comments_stage_id_fkey",
        "stage_comments",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("stage_photos_stage_id_fkey", "stage_photos", type_="foreignkey")
    op.create_foreign_key(
        "stage_photos_stage_id_fkey",
        "stage_photos",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("fk_stages_depends_on_stage_id_stages", "stages", type_="foreignkey")
    op.create_foreign_key(
        "fk_stages_depends_on_stage_id_stages",
        "stages",
        "stages",
        ["depends_on_stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("stages_project_id_fkey", "stages", type_="foreignkey")
    op.create_foreign_key(
        "stages_project_id_fkey",
        "stages",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("suppliers_project_id_fkey", "suppliers", type_="foreignkey")
    op.create_foreign_key(
        "suppliers_project_id_fkey",
        "suppliers",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("waste_orders_project_id_fkey", "waste_orders", type_="foreignkey")
    op.create_foreign_key(
        "waste_orders_project_id_fkey",
        "waste_orders",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("waste_orders_room_id_fkey", "waste_orders", type_="foreignkey")
    op.create_foreign_key(
        "waste_orders_room_id_fkey",
        "waste_orders",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("work_acceptances_project_id_fkey", "work_acceptances", type_="foreignkey")
    op.create_foreign_key(
        "work_acceptances_project_id_fkey",
        "work_acceptances",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("work_acceptances_room_id_fkey", "work_acceptances", type_="foreignkey")
    op.create_foreign_key(
        "work_acceptances_room_id_fkey",
        "work_acceptances",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("work_acceptances_stage_id_fkey", "work_acceptances", type_="foreignkey")
    op.create_foreign_key(
        "work_acceptances_stage_id_fkey",
        "work_acceptances",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("work_dependencies_depends_on_material_pick_id_fkey", "work_dependencies", type_="foreignkey")
    op.create_foreign_key(
        "work_dependencies_depends_on_material_pick_id_fkey",
        "work_dependencies",
        "material_picks",
        ["depends_on_material_pick_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("work_dependencies_depends_on_stage_id_fkey", "work_dependencies", type_="foreignkey")
    op.create_foreign_key(
        "work_dependencies_depends_on_stage_id_fkey",
        "work_dependencies",
        "stages",
        ["depends_on_stage_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("work_dependencies_project_id_fkey", "work_dependencies", type_="foreignkey")
    op.create_foreign_key(
        "work_dependencies_project_id_fkey",
        "work_dependencies",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("work_dependencies_stage_id_fkey", "work_dependencies", type_="foreignkey")
    op.create_foreign_key(
        "work_dependencies_stage_id_fkey",
        "work_dependencies",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("work_orders_chat_thread_id_fkey", "work_orders", type_="foreignkey")
    op.create_foreign_key(
        "work_orders_chat_thread_id_fkey",
        "work_orders",
        "chat_threads",
        ["chat_thread_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("work_orders_project_id_fkey", "work_orders", type_="foreignkey")
    op.create_foreign_key(
        "work_orders_project_id_fkey",
        "work_orders",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("work_orders_room_id_fkey", "work_orders", type_="foreignkey")
    op.create_foreign_key(
        "work_orders_room_id_fkey",
        "work_orders",
        "rooms",
        ["room_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("work_orders_stage_id_fkey", "work_orders", type_="foreignkey")
    op.create_foreign_key(
        "work_orders_stage_id_fkey",
        "work_orders",
        "stages",
        ["stage_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("work_orders_stage_id_fkey", "work_orders", type_="foreignkey")
    op.create_foreign_key(
        "work_orders_stage_id_fkey",
        "work_orders",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("work_orders_room_id_fkey", "work_orders", type_="foreignkey")
    op.create_foreign_key(
        "work_orders_room_id_fkey",
        "work_orders",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("work_orders_project_id_fkey", "work_orders", type_="foreignkey")
    op.create_foreign_key(
        "work_orders_project_id_fkey",
        "work_orders",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("work_orders_chat_thread_id_fkey", "work_orders", type_="foreignkey")
    op.create_foreign_key(
        "work_orders_chat_thread_id_fkey",
        "work_orders",
        "chat_threads",
        ["chat_thread_id"],
        ["id"],
    )

    op.drop_constraint("work_dependencies_stage_id_fkey", "work_dependencies", type_="foreignkey")
    op.create_foreign_key(
        "work_dependencies_stage_id_fkey",
        "work_dependencies",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("work_dependencies_project_id_fkey", "work_dependencies", type_="foreignkey")
    op.create_foreign_key(
        "work_dependencies_project_id_fkey",
        "work_dependencies",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("work_dependencies_depends_on_stage_id_fkey", "work_dependencies", type_="foreignkey")
    op.create_foreign_key(
        "work_dependencies_depends_on_stage_id_fkey",
        "work_dependencies",
        "stages",
        ["depends_on_stage_id"],
        ["id"],
    )

    op.drop_constraint("work_dependencies_depends_on_material_pick_id_fkey", "work_dependencies", type_="foreignkey")
    op.create_foreign_key(
        "work_dependencies_depends_on_material_pick_id_fkey",
        "work_dependencies",
        "material_picks",
        ["depends_on_material_pick_id"],
        ["id"],
    )

    op.drop_constraint("work_acceptances_stage_id_fkey", "work_acceptances", type_="foreignkey")
    op.create_foreign_key(
        "work_acceptances_stage_id_fkey",
        "work_acceptances",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("work_acceptances_room_id_fkey", "work_acceptances", type_="foreignkey")
    op.create_foreign_key(
        "work_acceptances_room_id_fkey",
        "work_acceptances",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("work_acceptances_project_id_fkey", "work_acceptances", type_="foreignkey")
    op.create_foreign_key(
        "work_acceptances_project_id_fkey",
        "work_acceptances",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("waste_orders_room_id_fkey", "waste_orders", type_="foreignkey")
    op.create_foreign_key(
        "waste_orders_room_id_fkey",
        "waste_orders",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("waste_orders_project_id_fkey", "waste_orders", type_="foreignkey")
    op.create_foreign_key(
        "waste_orders_project_id_fkey",
        "waste_orders",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("suppliers_project_id_fkey", "suppliers", type_="foreignkey")
    op.create_foreign_key(
        "suppliers_project_id_fkey",
        "suppliers",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("stages_project_id_fkey", "stages", type_="foreignkey")
    op.create_foreign_key(
        "stages_project_id_fkey",
        "stages",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("fk_stages_depends_on_stage_id_stages", "stages", type_="foreignkey")
    op.create_foreign_key(
        "fk_stages_depends_on_stage_id_stages",
        "stages",
        "stages",
        ["depends_on_stage_id"],
        ["id"],
    )

    op.drop_constraint("stage_photos_stage_id_fkey", "stage_photos", type_="foreignkey")
    op.create_foreign_key(
        "stage_photos_stage_id_fkey",
        "stage_photos",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("stage_comments_stage_id_fkey", "stage_comments", type_="foreignkey")
    op.create_foreign_key(
        "stage_comments_stage_id_fkey",
        "stage_comments",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("selection_items_room_id_fkey", "selection_items", type_="foreignkey")
    op.create_foreign_key(
        "selection_items_room_id_fkey",
        "selection_items",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("selection_items_project_id_fkey", "selection_items", type_="foreignkey")
    op.create_foreign_key(
        "selection_items_project_id_fkey",
        "selection_items",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("scratchpad_lines_project_id_fkey", "scratchpad_lines", type_="foreignkey")
    op.create_foreign_key(
        "scratchpad_lines_project_id_fkey",
        "scratchpad_lines",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("rooms_project_id_fkey", "rooms", type_="foreignkey")
    op.create_foreign_key(
        "rooms_project_id_fkey",
        "rooms",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("fk_rooms_floor_id_property_floors", "rooms", type_="foreignkey")
    op.create_foreign_key(
        "fk_rooms_floor_id_property_floors",
        "rooms",
        "property_floors",
        ["floor_id"],
        ["id"],
    )

    op.drop_constraint("room_change_requests_room_id_fkey", "room_change_requests", type_="foreignkey")
    op.create_foreign_key(
        "room_change_requests_room_id_fkey",
        "room_change_requests",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("room_change_requests_project_id_fkey", "room_change_requests", type_="foreignkey")
    op.create_foreign_key(
        "room_change_requests_project_id_fkey",
        "room_change_requests",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("room_change_logs_room_id_fkey", "room_change_logs", type_="foreignkey")
    op.create_foreign_key(
        "room_change_logs_room_id_fkey",
        "room_change_logs",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("receipts_project_id_fkey", "receipts", type_="foreignkey")
    op.create_foreign_key(
        "receipts_project_id_fkey",
        "receipts",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("receipts_payment_id_fkey", "receipts", type_="foreignkey")
    op.create_foreign_key(
        "receipts_payment_id_fkey",
        "receipts",
        "payments",
        ["payment_id"],
        ["id"],
    )

    op.drop_constraint("purchases_supplier_id_fkey", "purchases", type_="foreignkey")
    op.create_foreign_key(
        "purchases_supplier_id_fkey",
        "purchases",
        "suppliers",
        ["supplier_id"],
        ["id"],
    )

    op.drop_constraint("purchases_project_id_fkey", "purchases", type_="foreignkey")
    op.create_foreign_key(
        "purchases_project_id_fkey",
        "purchases",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("purchase_items_purchase_id_fkey", "purchase_items", type_="foreignkey")
    op.create_foreign_key(
        "purchase_items_purchase_id_fkey",
        "purchase_items",
        "purchases",
        ["purchase_id"],
        ["id"],
    )

    op.drop_constraint("purchase_items_material_pick_id_fkey", "purchase_items", type_="foreignkey")
    op.create_foreign_key(
        "purchase_items_material_pick_id_fkey",
        "purchase_items",
        "material_picks",
        ["material_pick_id"],
        ["id"],
    )

    op.drop_constraint("property_objects_project_id_fkey", "property_objects", type_="foreignkey")
    op.create_foreign_key(
        "property_objects_project_id_fkey",
        "property_objects",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("property_floors_project_id_fkey", "property_floors", type_="foreignkey")
    op.create_foreign_key(
        "property_floors_project_id_fkey",
        "property_floors",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("project_work_schedules_supersedes_id_fkey", "project_work_schedules", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedules_supersedes_id_fkey",
        "project_work_schedules",
        "project_work_schedules",
        ["supersedes_id"],
        ["id"],
    )

    op.drop_constraint("project_work_schedules_project_id_fkey", "project_work_schedules", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedules_project_id_fkey",
        "project_work_schedules",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("project_work_schedule_items_stage_id_fkey", "project_work_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedule_items_stage_id_fkey",
        "project_work_schedule_items",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("project_work_schedule_items_schedule_id_fkey", "project_work_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedule_items_schedule_id_fkey",
        "project_work_schedule_items",
        "project_work_schedules",
        ["schedule_id"],
        ["id"],
    )

    op.drop_constraint("project_work_schedule_items_project_id_fkey", "project_work_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedule_items_project_id_fkey",
        "project_work_schedule_items",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("project_work_schedule_items_depends_on_item_id_fkey", "project_work_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "project_work_schedule_items_depends_on_item_id_fkey",
        "project_work_schedule_items",
        "project_work_schedule_items",
        ["depends_on_item_id"],
        ["id"],
    )

    op.drop_constraint("project_viewers_project_id_fkey", "project_viewers", type_="foreignkey")
    op.create_foreign_key(
        "project_viewers_project_id_fkey",
        "project_viewers",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("project_technical_supervisor_assi_supersedes_assignment_id_fkey", "project_technical_supervisor_assignments", type_="foreignkey")
    op.create_foreign_key(
        "project_technical_supervisor_assi_supersedes_assignment_id_fkey",
        "project_technical_supervisor_assignments",
        "project_technical_supervisor_assignments",
        ["supersedes_assignment_id"],
        ["id"],
    )

    op.drop_constraint("project_issues_stage_id_fkey", "project_issues", type_="foreignkey")
    op.create_foreign_key(
        "project_issues_stage_id_fkey",
        "project_issues",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("project_issues_room_id_fkey", "project_issues", type_="foreignkey")
    op.create_foreign_key(
        "project_issues_room_id_fkey",
        "project_issues",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("project_issues_project_id_fkey", "project_issues", type_="foreignkey")
    op.create_foreign_key(
        "project_issues_project_id_fkey",
        "project_issues",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("project_issues_floor_plan_id_fkey", "project_issues", type_="foreignkey")
    op.create_foreign_key(
        "project_issues_floor_plan_id_fkey",
        "project_issues",
        "floor_plans",
        ["floor_plan_id"],
        ["id"],
    )

    op.drop_constraint("project_documents_work_acceptance_id_fkey", "project_documents", type_="foreignkey")
    op.create_foreign_key(
        "project_documents_work_acceptance_id_fkey",
        "project_documents",
        "work_acceptances",
        ["work_acceptance_id"],
        ["id"],
    )

    op.drop_constraint("project_documents_stage_id_fkey", "project_documents", type_="foreignkey")
    op.create_foreign_key(
        "project_documents_stage_id_fkey",
        "project_documents",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("project_documents_receipt_id_fkey", "project_documents", type_="foreignkey")
    op.create_foreign_key(
        "project_documents_receipt_id_fkey",
        "project_documents",
        "receipts",
        ["receipt_id"],
        ["id"],
    )

    op.drop_constraint("project_documents_payment_id_fkey", "project_documents", type_="foreignkey")
    op.create_foreign_key(
        "project_documents_payment_id_fkey",
        "project_documents",
        "payments",
        ["payment_id"],
        ["id"],
    )

    op.drop_constraint("project_checklist_templates_project_id_fkey", "project_checklist_templates", type_="foreignkey")
    op.create_foreign_key(
        "project_checklist_templates_project_id_fkey",
        "project_checklist_templates",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("payments_stage_id_fkey", "payments", type_="foreignkey")
    op.create_foreign_key(
        "payments_stage_id_fkey",
        "payments",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("payments_project_id_fkey", "payments", type_="foreignkey")
    op.create_foreign_key(
        "payments_project_id_fkey",
        "payments",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("payment_evidence_project_id_fkey", "payment_evidence", type_="foreignkey")
    op.create_foreign_key(
        "payment_evidence_project_id_fkey",
        "payment_evidence",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("payment_evidence_payment_id_fkey", "payment_evidence", type_="foreignkey")
    op.create_foreign_key(
        "payment_evidence_payment_id_fkey",
        "payment_evidence",
        "payments",
        ["payment_id"],
        ["id"],
    )

    op.drop_constraint("payment_events_payment_id_fkey", "payment_events", type_="foreignkey")
    op.create_foreign_key(
        "payment_events_payment_id_fkey",
        "payment_events",
        "payments",
        ["payment_id"],
        ["id"],
    )

    op.drop_constraint("material_picks_room_id_fkey", "material_picks", type_="foreignkey")
    op.create_foreign_key(
        "material_picks_room_id_fkey",
        "material_picks",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("material_picks_project_id_fkey", "material_picks", type_="foreignkey")
    op.create_foreign_key(
        "material_picks_project_id_fkey",
        "material_picks",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("margin_snapshots_project_id_fkey", "margin_snapshots", type_="foreignkey")
    op.create_foreign_key(
        "margin_snapshots_project_id_fkey",
        "margin_snapshots",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("furniture_items_room_id_fkey", "furniture_items", type_="foreignkey")
    op.create_foreign_key(
        "furniture_items_room_id_fkey",
        "furniture_items",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("furniture_items_project_id_fkey", "furniture_items", type_="foreignkey")
    op.create_foreign_key(
        "furniture_items_project_id_fkey",
        "furniture_items",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("furniture_items_floor_plan_id_fkey", "furniture_items", type_="foreignkey")
    op.create_foreign_key(
        "furniture_items_floor_plan_id_fkey",
        "furniture_items",
        "floor_plans",
        ["floor_plan_id"],
        ["id"],
    )

    op.drop_constraint("floor_plans_project_id_fkey", "floor_plans", type_="foreignkey")
    op.create_foreign_key(
        "floor_plans_project_id_fkey",
        "floor_plans",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("floor_plan_pins_room_id_fkey", "floor_plan_pins", type_="foreignkey")
    op.create_foreign_key(
        "floor_plan_pins_room_id_fkey",
        "floor_plan_pins",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("floor_plan_pins_floor_plan_id_fkey", "floor_plan_pins", type_="foreignkey")
    op.create_foreign_key(
        "floor_plan_pins_floor_plan_id_fkey",
        "floor_plan_pins",
        "floor_plans",
        ["floor_plan_id"],
        ["id"],
    )

    op.drop_constraint("expenses_stage_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_stage_id_fkey",
        "expenses",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("expenses_room_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_room_id_fkey",
        "expenses",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("expenses_receipt_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_receipt_id_fkey",
        "expenses",
        "receipts",
        ["receipt_id"],
        ["id"],
    )

    op.drop_constraint("expenses_project_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_project_id_fkey",
        "expenses",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("expenses_payment_id_fkey", "expenses", type_="foreignkey")
    op.create_foreign_key(
        "expenses_payment_id_fkey",
        "expenses",
        "payments",
        ["payment_id"],
        ["id"],
    )

    op.drop_constraint("estimate_lines_room_id_fkey", "estimate_lines", type_="foreignkey")
    op.create_foreign_key(
        "estimate_lines_room_id_fkey",
        "estimate_lines",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("estimate_lines_project_id_fkey", "estimate_lines", type_="foreignkey")
    op.create_foreign_key(
        "estimate_lines_project_id_fkey",
        "estimate_lines",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("document_versions_document_id_fkey", "document_versions", type_="foreignkey")
    op.create_foreign_key(
        "document_versions_document_id_fkey",
        "document_versions",
        "project_documents",
        ["document_id"],
        ["id"],
    )

    op.drop_constraint("document_signatures_version_id_fkey", "document_signatures", type_="foreignkey")
    op.create_foreign_key(
        "document_signatures_version_id_fkey",
        "document_signatures",
        "document_versions",
        ["version_id"],
        ["id"],
    )

    op.drop_constraint("document_signatures_document_id_fkey", "document_signatures", type_="foreignkey")
    op.create_foreign_key(
        "document_signatures_document_id_fkey",
        "document_signatures",
        "project_documents",
        ["document_id"],
        ["id"],
    )

    op.drop_constraint("design_packages_project_id_fkey", "design_packages", type_="foreignkey")
    op.create_foreign_key(
        "design_packages_project_id_fkey",
        "design_packages",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("comment_reactions_comment_id_fkey", "comment_reactions", type_="foreignkey")
    op.create_foreign_key(
        "comment_reactions_comment_id_fkey",
        "comment_reactions",
        "stage_comments",
        ["comment_id"],
        ["id"],
    )

    op.drop_constraint("chat_threads_project_id_fkey", "chat_threads", type_="foreignkey")
    op.create_foreign_key(
        "chat_threads_project_id_fkey",
        "chat_threads",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("chat_thread_reads_thread_id_fkey", "chat_thread_reads", type_="foreignkey")
    op.create_foreign_key(
        "chat_thread_reads_thread_id_fkey",
        "chat_thread_reads",
        "chat_threads",
        ["thread_id"],
        ["id"],
    )

    op.drop_constraint("chat_thread_participants_thread_id_fkey", "chat_thread_participants", type_="foreignkey")
    op.create_foreign_key(
        "chat_thread_participants_thread_id_fkey",
        "chat_thread_participants",
        "chat_threads",
        ["thread_id"],
        ["id"],
    )

    op.drop_constraint("chat_messages_thread_id_fkey", "chat_messages", type_="foreignkey")
    op.create_foreign_key(
        "chat_messages_thread_id_fkey",
        "chat_messages",
        "chat_threads",
        ["thread_id"],
        ["id"],
    )

    op.drop_constraint("chat_messages_reply_to_id_fkey", "chat_messages", type_="foreignkey")
    op.create_foreign_key(
        "chat_messages_reply_to_id_fkey",
        "chat_messages",
        "chat_messages",
        ["reply_to_id"],
        ["id"],
    )

    op.drop_constraint("change_orders_project_id_fkey", "change_orders", type_="foreignkey")
    op.create_foreign_key(
        "change_orders_project_id_fkey",
        "change_orders",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("fk_calendar_items_stage_id_stages", "calendar_items", type_="foreignkey")
    op.create_foreign_key(
        "fk_calendar_items_stage_id_stages",
        "calendar_items",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("fk_calendar_items_project_id_projects", "calendar_items", type_="foreignkey")
    op.create_foreign_key(
        "fk_calendar_items_project_id_projects",
        "calendar_items",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("budget_lines_stage_id_fkey", "budget_lines", type_="foreignkey")
    op.create_foreign_key(
        "budget_lines_stage_id_fkey",
        "budget_lines",
        "stages",
        ["stage_id"],
        ["id"],
    )

    op.drop_constraint("budget_lines_room_id_fkey", "budget_lines", type_="foreignkey")
    op.create_foreign_key(
        "budget_lines_room_id_fkey",
        "budget_lines",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("budget_lines_project_id_fkey", "budget_lines", type_="foreignkey")
    op.create_foreign_key(
        "budget_lines_project_id_fkey",
        "budget_lines",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("budget_lines_estimate_line_id_fkey", "budget_lines", type_="foreignkey")
    op.create_foreign_key(
        "budget_lines_estimate_line_id_fkey",
        "budget_lines",
        "estimate_lines",
        ["estimate_line_id"],
        ["id"],
    )

    op.drop_constraint("budget_alert_sent_room_id_fkey", "budget_alert_sent", type_="foreignkey")
    op.create_foreign_key(
        "budget_alert_sent_room_id_fkey",
        "budget_alert_sent",
        "rooms",
        ["room_id"],
        ["id"],
    )

    op.drop_constraint("app_notifications_project_id_fkey", "app_notifications", type_="foreignkey")
    op.create_foreign_key(
        "app_notifications_project_id_fkey",
        "app_notifications",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint("activity_events_project_id_fkey", "activity_events", type_="foreignkey")
    op.create_foreign_key(
        "activity_events_project_id_fkey",
        "activity_events",
        "projects",
        ["project_id"],
        ["id"],
    )
