"""index project/thread/stage/room scope columns on core domain tables

Every ``GET /projects/{project_id}/...`` read and every chat thread read filters
on a scope foreign key. PostgreSQL does not index foreign keys automatically, so
the core tables created before w13 have been sequential-scanned since the first
migration. Newer tables (selection_items, project_documents, activity_events,
budget_lines, expenses, waste_orders, project_participants) already carry their
scope index; this migration closes the remaining gap on the legacy core.

The same columns are also the traversal path for project purge/trash cleanup,
so the indexes bound delete cost as well as read cost.

PostgreSQL builds the indexes with CREATE INDEX CONCURRENTLY inside an
autocommit block so an upgrade never takes a write lock on a live table.
Other dialects (the bounded local/test SQLite path) use the plain form, which
is equivalent there. Every statement is IF NOT EXISTS / IF EXISTS so the
migration is idempotent and safe to re-run after an interrupted concurrent
build left an invalid index behind.

Revision ID: w23scopeindexes01
Revises: w22projectparticipants01
Create Date: 2026-09-17
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "w23scopeindexes01"
down_revision: str | None = "w22projectparticipants01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (index name, table, column). Names follow the SQLAlchemy ``index=True``
# convention so ORM metadata.create_all and this migration agree.
SCOPE_INDEXES: tuple[tuple[str, str, str], ...] = (
    # project scope — the dominant read filter
    ("ix_rooms_project_id", "rooms", "project_id"),
    ("ix_stages_project_id", "stages", "project_id"),
    ("ix_payments_project_id", "payments", "project_id"),
    ("ix_receipts_project_id", "receipts", "project_id"),
    ("ix_change_orders_project_id", "change_orders", "project_id"),
    ("ix_estimate_lines_project_id", "estimate_lines", "project_id"),
    ("ix_chat_threads_project_id", "chat_threads", "project_id"),
    ("ix_room_change_requests_project_id", "room_change_requests", "project_id"),
    ("ix_app_notifications_project_id", "app_notifications", "project_id"),
    # thread scope — every chat open
    ("ix_chat_messages_thread_id", "chat_messages", "thread_id"),
    # stage scope
    ("ix_stage_comments_stage_id", "stage_comments", "stage_id"),
    ("ix_stage_photos_stage_id", "stage_photos", "stage_id"),
    ("ix_payments_stage_id", "payments", "stage_id"),
    ("ix_receipts_stage_id", "receipts", "stage_id"),
    ("ix_expenses_stage_id", "expenses", "stage_id"),
    ("ix_budget_lines_stage_id", "budget_lines", "stage_id"),
    ("ix_project_issues_stage_id", "project_issues", "stage_id"),
    # room scope
    ("ix_estimate_lines_room_id", "estimate_lines", "room_id"),
    ("ix_receipts_room_id", "receipts", "room_id"),
    ("ix_expenses_room_id", "expenses", "room_id"),
    ("ix_budget_lines_room_id", "budget_lines", "room_id"),
    ("ix_project_issues_room_id", "project_issues", "room_id"),
    ("ix_room_change_requests_room_id", "room_change_requests", "room_id"),
    ("ix_work_acceptances_room_id", "work_acceptances", "room_id"),
    # project ownership lookups used by every project list for both roles
    ("ix_projects_customer_id", "projects", "customer_id"),
    ("ix_projects_contractor_id", "projects", "contractor_id"),
)


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if _is_postgresql():
        # CONCURRENTLY cannot run inside the migration transaction.
        with op.get_context().autocommit_block():
            for name, table, column in SCOPE_INDEXES:
                op.execute(
                    f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{name}" '
                    f'ON "{table}" ("{column}")'
                )
        return

    for name, table, column in SCOPE_INDEXES:
        op.execute(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ("{column}")')


def downgrade() -> None:
    if _is_postgresql():
        with op.get_context().autocommit_block():
            for name, _table, _column in reversed(SCOPE_INDEXES):
                op.execute(f'DROP INDEX CONCURRENTLY IF EXISTS "{name}"')
        return

    for name, _table, _column in reversed(SCOPE_INDEXES):
        op.execute(f'DROP INDEX IF EXISTS "{name}"')
