"""document_versions OCR flags + signature provider fields

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
"""
from alembic import op
import sqlalchemy as sa

revision = "o5p6q7r8s9t0"
down_revision = "n4o5p6q7r8s9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_versions", sa.Column("ocr_status", sa.String(16), nullable=False, server_default="none"))
    op.add_column("document_versions", sa.Column("ocr_job_id", sa.String(64), nullable=True))
    op.add_column("document_versions", sa.Column("ocr_suggested_type", sa.String(32), nullable=True))
    op.add_column("document_versions", sa.Column("ocr_confidence", sa.Float(), nullable=True))
    op.add_column("document_versions", sa.Column("ocr_completed_at", sa.DateTime(), nullable=True))
    op.add_column("document_versions", sa.Column("ocr_error", sa.String(255), nullable=True))

    op.add_column(
        "document_signatures",
        sa.Column("provider_name", sa.String(32), nullable=False, server_default="in_app"),
    )
    op.add_column(
        "document_signatures",
        sa.Column("provider_external_id", sa.String(128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("document_signatures", "provider_external_id")
    op.drop_column("document_signatures", "provider_name")
    op.drop_column("document_versions", "ocr_error")
    op.drop_column("document_versions", "ocr_completed_at")
    op.drop_column("document_versions", "ocr_confidence")
    op.drop_column("document_versions", "ocr_suggested_type")
    op.drop_column("document_versions", "ocr_job_id")
    op.drop_column("document_versions", "ocr_status")
