"""Personal team invitations with acceptance (MKT-022)

team_invites.invitee_user_id: NULL = link/QR invite; set = personal phone invite
that only the invitee can accept or decline (membership is created on accept).

Revision ID: x05teaminviteinvitee01
Revises: x04roomaddreq01
"""

from alembic import op
import sqlalchemy as sa


revision = "x05teaminviteinvitee01"
down_revision = "x04roomaddreq01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("team_invites", sa.Column("invitee_user_id", sa.String(36), nullable=True))
    op.create_index("ix_team_invites_invitee_user_id", "team_invites", ["invitee_user_id"])


def downgrade() -> None:
    op.drop_index("ix_team_invites_invitee_user_id", table_name="team_invites")
    op.drop_column("team_invites", "invitee_user_id")
