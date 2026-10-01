"""Room-change request can add a room (QLT-007)

room_id becomes nullable (NULL = "add room" request, fields in payload_json);
created_room_id records the room created on approval.

Revision ID: x04roomaddreq01
Revises: x03contractsnap01
"""

from alembic import op
import sqlalchemy as sa


revision = "x04roomaddreq01"
down_revision = "x03contractsnap01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("room_change_requests", "room_id", existing_type=sa.String(36), nullable=True)
    op.add_column("room_change_requests", sa.Column("created_room_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_room_change_requests_created_room_id",
        "room_change_requests",
        "rooms",
        ["created_room_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_room_change_requests_created_room_id", "room_change_requests", type_="foreignkey")
    op.drop_column("room_change_requests", "created_room_id")
    # Add-room requests have no room: drop them before restoring NOT NULL.
    op.execute("DELETE FROM room_change_requests WHERE room_id IS NULL")
    op.alter_column("room_change_requests", "room_id", existing_type=sa.String(36), nullable=False)
