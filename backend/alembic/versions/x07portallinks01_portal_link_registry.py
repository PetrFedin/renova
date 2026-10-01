"""Portal link registry for revocation (INB-04)

portal_links: one row per issued magic link (token jti). Revoking sets
revoked_at; session exchange and portal JWTs minted from the link are rejected.

Revision ID: x07portallinks01
Revises: x06coinvoicelink01
"""

from alembic import op
import sqlalchemy as sa


revision = "x07portallinks01"
down_revision = "x06coinvoicelink01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("issued_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("scopes", sa.String(255), nullable=False, server_default="read"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_portal_links_project_id", "portal_links", ["project_id"])
    op.create_index("ix_portal_links_user_id", "portal_links", ["user_id"])
    op.create_index("ix_portal_links_issued_by", "portal_links", ["issued_by"])


def downgrade() -> None:
    op.drop_index("ix_portal_links_issued_by", table_name="portal_links")
    op.drop_index("ix_portal_links_user_id", table_name="portal_links")
    op.drop_index("ix_portal_links_project_id", table_name="portal_links")
    op.drop_table("portal_links")
