"""add project-scoped contractor participants and scopes

Revision ID: w22projectparticipants01
Revises: w21materialprice01
Create Date: 2026-09-06
"""
from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import json
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = "w22projectparticipants01"
down_revision: str | None = "w21materialprice01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BACKFILL_NAMESPACE = uuid.UUID("59ea920f-8e13-4e8d-90a4-f189408cba23")


def _utc_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def upgrade() -> None:
    op.create_table(
        "project_participants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("participant_role", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("all_scope", sa.Boolean(), nullable=False),
        sa.Column("can_manage_schedule", sa.Boolean(), nullable=False),
        sa.Column("can_manage_commercial", sa.Boolean(), nullable=False),
        sa.Column("can_manage_documents", sa.Boolean(), nullable=False),
        sa.Column("added_by", sa.String(length=36), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=False),
        sa.Column("removed_by", sa.String(length=36), nullable=True),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "participant_role IN ('lead_contractor','contractor')",
            name="ck_project_participants_role",
        ),
        sa.CheckConstraint(
            "status IN ('active','removed')",
            name="ck_project_participants_status",
        ),
        sa.ForeignKeyConstraint(["added_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["removed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_participant_user"),
    )
    op.create_index("ix_project_participants_project_id", "project_participants", ["project_id"])
    op.create_index("ix_project_participants_user_id", "project_participants", ["user_id"])
    op.create_index("ix_project_participants_status", "project_participants", ["status"])

    op.create_table(
        "project_participant_scopes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("participant_id", sa.String(length=36), nullable=False),
        sa.Column("scope_type", sa.String(length=16), nullable=False),
        sa.Column("scope_ref", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "scope_type IN ('stage','room','work_type')",
            name="ck_project_participant_scopes_type",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["participant_id"], ["project_participants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "participant_id",
            "scope_type",
            "scope_ref",
            name="uq_project_participant_scope",
        ),
    )
    op.create_index(
        "ix_project_participant_scopes_participant_id",
        "project_participant_scopes",
        ["participant_id"],
    )
    op.create_index(
        "ix_project_participant_scopes_scope_type",
        "project_participant_scopes",
        ["scope_type"],
    )
    op.create_index(
        "ix_project_participant_scopes_scope_ref",
        "project_participant_scopes",
        ["scope_ref"],
    )

    op.create_table(
        "project_participant_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("participant_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("actor_id", sa.String(length=36), nullable=True),
        sa.Column("snapshot_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "event_type IN ('backfilled_lead','added','scope_replaced','removed','reactivated')",
            name="ck_project_participant_events_type",
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["participant_id"], ["project_participants.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_participant_events_participant_id",
        "project_participant_events",
        ["participant_id"],
    )
    op.create_index(
        "ix_project_participant_events_project_id",
        "project_participant_events",
        ["project_id"],
    )
    op.create_index(
        "ix_project_participant_events_user_id",
        "project_participant_events",
        ["user_id"],
    )
    op.create_index(
        "ix_project_participant_events_event_type",
        "project_participant_events",
        ["event_type"],
    )
    op.create_index(
        "ix_project_participant_events_created_at",
        "project_participant_events",
        ["created_at"],
    )

    # Backfill is intentionally narrow and truth-preserving: the one existing
    # Project.contractor_id is already authoritative as the current lead/general
    # contractor, so it can be represented as an all-scope lead participant.
    # We do not infer any independent contractor scopes from unrelated historical
    # assignee/team rows.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id AS project_id, contractor_id "
            "FROM projects WHERE contractor_id IS NOT NULL"
        )
    ).mappings().all()
    participant_table = sa.table(
        "project_participants",
        sa.column("id", sa.String),
        sa.column("project_id", sa.String),
        sa.column("user_id", sa.String),
        sa.column("participant_role", sa.String),
        sa.column("status", sa.String),
        sa.column("all_scope", sa.Boolean),
        sa.column("can_manage_schedule", sa.Boolean),
        sa.column("can_manage_commercial", sa.Boolean),
        sa.column("can_manage_documents", sa.Boolean),
        sa.column("added_by", sa.String),
        sa.column("added_at", sa.DateTime),
        sa.column("removed_by", sa.String),
        sa.column("removed_at", sa.DateTime),
    )
    event_table = sa.table(
        "project_participant_events",
        sa.column("id", sa.String),
        sa.column("participant_id", sa.String),
        sa.column("project_id", sa.String),
        sa.column("user_id", sa.String),
        sa.column("event_type", sa.String),
        sa.column("actor_id", sa.String),
        sa.column("snapshot_json", sa.Text),
        sa.column("created_at", sa.DateTime),
    )
    now = _utc_naive()
    for row in rows:
        project_id = str(row["project_id"])
        contractor_id = str(row["contractor_id"])
        participant_id = str(
            uuid.uuid5(_BACKFILL_NAMESPACE, f"lead:{project_id}:{contractor_id}")
        )
        event_id = str(
            uuid.uuid5(_BACKFILL_NAMESPACE, f"event:{project_id}:{contractor_id}")
        )
        bind.execute(
            participant_table.insert().values(
                id=participant_id,
                project_id=project_id,
                user_id=contractor_id,
                participant_role="lead_contractor",
                status="active",
                all_scope=True,
                can_manage_schedule=True,
                can_manage_commercial=True,
                can_manage_documents=True,
                added_by=None,
                added_at=now,
                removed_by=None,
                removed_at=None,
            )
        )
        bind.execute(
            event_table.insert().values(
                id=event_id,
                participant_id=participant_id,
                project_id=project_id,
                user_id=contractor_id,
                event_type="backfilled_lead",
                actor_id=None,
                snapshot_json=json.dumps(
                    {
                        "source": "projects.contractor_id",
                        "all_scope": True,
                        "historical_actor": "unknown",
                    },
                    sort_keys=True,
                ),
                created_at=now,
            )
        )


def downgrade() -> None:
    op.drop_index("ix_project_participant_events_created_at", table_name="project_participant_events")
    op.drop_index("ix_project_participant_events_event_type", table_name="project_participant_events")
    op.drop_index("ix_project_participant_events_user_id", table_name="project_participant_events")
    op.drop_index("ix_project_participant_events_project_id", table_name="project_participant_events")
    op.drop_index("ix_project_participant_events_participant_id", table_name="project_participant_events")
    op.drop_table("project_participant_events")

    op.drop_index("ix_project_participant_scopes_scope_ref", table_name="project_participant_scopes")
    op.drop_index("ix_project_participant_scopes_scope_type", table_name="project_participant_scopes")
    op.drop_index("ix_project_participant_scopes_participant_id", table_name="project_participant_scopes")
    op.drop_table("project_participant_scopes")

    op.drop_index("ix_project_participants_status", table_name="project_participants")
    op.drop_index("ix_project_participants_user_id", table_name="project_participants")
    op.drop_index("ix_project_participants_project_id", table_name="project_participants")
    op.drop_table("project_participants")
