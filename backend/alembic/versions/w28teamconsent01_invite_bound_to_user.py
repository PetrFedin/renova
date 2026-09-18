"""bind a phone invitation to the person it was sent to

`POST /teams/invite` создавал членство в бригаде сразу, без согласия
приглашаемого. Членство в бригаде подрядчика — вход в
`_assert_independent`: технадзор, оказавшийся в бригаде проверяемого,
перестаёт быть независимым и теряет доступ к проекту. Правило верное, но
его вход был подконтролен той стороне, которую оно ограничивает.

Приглашение по телефону теперь выдаёт токен, как `invite-link` и
`invite-sms`, а членство создаёт `/teams/join` — то есть сам приглашённый.
Токен привязан к адресату: личное приглашение не должно пересылаться.

Revision ID: w28teamconsent01
Revises: w22projectparticipants01
Create Date: 2026-09-18
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w28teamconsent01"
down_revision: str | None = "w22projectparticipants01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Nullable: ссылка-приглашение и QR остаются обезличенными, их может
    # предъявить любой исполнитель — это их назначение.
    if not _has_column("team_invites", "invited_user_id"):
        op.add_column(
            "team_invites",
            sa.Column("invited_user_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_team_invites_invited_user",
            "team_invites",
            "users",
            ["invited_user_id"],
            ["id"],
        )
        op.create_index(
            "ix_team_invites_invited_user_id", "team_invites", ["invited_user_id"]
        )


def downgrade() -> None:
    if _has_column("team_invites", "invited_user_id"):
        op.drop_index("ix_team_invites_invited_user_id", table_name="team_invites")
        op.drop_constraint(
            "fk_team_invites_invited_user", "team_invites", type_="foreignkey"
        )
        op.drop_column("team_invites", "invited_user_id")
