"""add reversible estimate-line lifecycle metadata

Revision ID: w23estimatelifecycle01
Revises: w22projectparticipants01
Create Date: 2026-09-15
"""
from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision: str = "w23estimatelifecycle01"
down_revision: str | None = "w22projectparticipants01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SYSTEM_FINISH_NAMES = frozenset(
    {
        "Фартук плитка",
        "Напольное покрытие",
        "Электромонтаж кухни",
        "Плитка фартук",
        "Ламинат/кварц-винил",
        "Демонтаж покрытий",
        "Штукатурка стен",
        "Штукатурная смесь",
        "Гидроизоляция",
        "Укладка плитки",
        "Керамогранит",
        "Гидроизоляция Ceresit",
        "Подготовка стен",
        "Покраска стен 2 слоя",
        "Укладка ламината",
        "Краска интерьерная",
        "Ламинат",
    }
)


def _utc_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _origin_for_existing(row: dict) -> str:
    """Mirror the existing room generator's ownership rules without guessing imports."""
    if row.get("room_id") is None:
        return "manual"
    category = row.get("category")
    if category in {"electrical", "plumbing"}:
        return "system"
    if category == "finish" and row.get("name") in _SYSTEM_FINISH_NAMES:
        return "system"
    # Historical manual and CSV-import rows are not distinguishable in the old
    # schema. Preserve them as manual rather than inventing provenance.
    return "manual"


def upgrade() -> None:
    op.create_table(
        "estimate_line_lifecycles",
        # No FK to estimate_lines on purpose: a tombstone survives while the
        # active row is absent and is the restore source of truth.
        sa.Column("estimate_line_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=True),
        sa.Column("removed_by", sa.String(length=36), nullable=True),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "origin IN ('system','manual','import')",
            name="ck_estimate_line_lifecycles_origin",
        ),
        sa.CheckConstraint(
            "status IN ('active','removed')",
            name="ck_estimate_line_lifecycles_status",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["removed_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("estimate_line_id"),
    )
    op.create_index(
        "ix_estimate_line_lifecycles_project_id",
        "estimate_line_lifecycles",
        ["project_id"],
    )
    op.create_index(
        "ix_estimate_line_lifecycles_origin",
        "estimate_line_lifecycles",
        ["origin"],
    )
    op.create_index(
        "ix_estimate_line_lifecycles_status",
        "estimate_line_lifecycles",
        ["status"],
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, project_id, room_id, category, name FROM estimate_lines"
        )
    ).mappings().all()
    lifecycle = sa.table(
        "estimate_line_lifecycles",
        sa.column("estimate_line_id", sa.String),
        sa.column("project_id", sa.String),
        sa.column("origin", sa.String),
        sa.column("status", sa.String),
        sa.column("snapshot_json", sa.Text),
        sa.column("removed_by", sa.String),
        sa.column("removed_at", sa.DateTime),
        sa.column("created_at", sa.DateTime),
        sa.column("updated_at", sa.DateTime),
    )
    now = _utc_naive()
    for row in rows:
        bind.execute(
            lifecycle.insert().values(
                estimate_line_id=str(row["id"]),
                project_id=str(row["project_id"]),
                origin=_origin_for_existing(dict(row)),
                status="active",
                snapshot_json=None,
                removed_by=None,
                removed_at=None,
                created_at=now,
                updated_at=now,
            )
        )


def downgrade() -> None:
    op.drop_index("ix_estimate_line_lifecycles_status", table_name="estimate_line_lifecycles")
    op.drop_index("ix_estimate_line_lifecycles_origin", table_name="estimate_line_lifecycles")
    op.drop_index("ix_estimate_line_lifecycles_project_id", table_name="estimate_line_lifecycles")
    op.drop_table("estimate_line_lifecycles")
