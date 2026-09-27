"""Add ON DELETE CASCADE to the project-participant graph

Issue #319: w22projectparticipants01 created project_participants,
project_participant_scopes and project_participant_events with
project_id/participant_id foreign keys but no explicit ON DELETE
CASCADE. PostgreSQL defaults an unspecified foreign key action to
NO ACTION, so project_service.purge_project() (ORM-level
``db.delete(project)``) and project_service.empty_trash() (a bulk
``DELETE FROM projects ...``) both raise a ForeignKeyViolationError
whenever the project being purged has any participant/scope/event
rows — reproduced against a real PostgreSQL database prior to this
migration.

This is scoped to exactly the three tables this migration's
predecessor introduced. It intentionally does not touch older
project-child tables (payments, receipts, evidence, documents, ...),
whose purge/retention semantics are out of scope for this fix and
are tracked separately in #319.

Revision ID: w23participantpurgecascade01
Revises: w22projectparticipants01
Create Date: 2026-09-27
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "w23participantpurgecascade01"
down_revision: str | None = "w22projectparticipants01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "project_participants_project_id_fkey", "project_participants", type_="foreignkey"
    )
    op.create_foreign_key(
        "project_participants_project_id_fkey",
        "project_participants",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint(
        "project_participant_scopes_participant_id_fkey",
        "project_participant_scopes",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "project_participant_scopes_participant_id_fkey",
        "project_participant_scopes",
        "project_participants",
        ["participant_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint(
        "project_participant_events_participant_id_fkey",
        "project_participant_events",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "project_participant_events_participant_id_fkey",
        "project_participant_events",
        "project_participants",
        ["participant_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint(
        "project_participant_events_project_id_fkey",
        "project_participant_events",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "project_participant_events_project_id_fkey",
        "project_participant_events",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "project_participant_events_project_id_fkey",
        "project_participant_events",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "project_participant_events_project_id_fkey",
        "project_participant_events",
        "projects",
        ["project_id"],
        ["id"],
    )

    op.drop_constraint(
        "project_participant_events_participant_id_fkey",
        "project_participant_events",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "project_participant_events_participant_id_fkey",
        "project_participant_events",
        "project_participants",
        ["participant_id"],
        ["id"],
    )

    op.drop_constraint(
        "project_participant_scopes_participant_id_fkey",
        "project_participant_scopes",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "project_participant_scopes_participant_id_fkey",
        "project_participant_scopes",
        "project_participants",
        ["participant_id"],
        ["id"],
    )

    op.drop_constraint(
        "project_participants_project_id_fkey", "project_participants", type_="foreignkey"
    )
    op.create_foreign_key(
        "project_participants_project_id_fkey",
        "project_participants",
        "projects",
        ["project_id"],
        ["id"],
    )
