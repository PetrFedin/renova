"""project_documents + versions + signatures

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
"""
from alembic import op
import sqlalchemy as sa

revision = "m3n4o5p6q7r8"
down_revision = "l2m3n4o5p6q7"
branch_labels = None
depends_on = None



def _has_table(name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return name in insp.get_table_names()


def _ensure_work_acceptances() -> None:
    """Document Center FK; table often from create_all on SQLite historically."""
    if _has_table("work_acceptances"):
        return
    op.create_table(
        "work_acceptances",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False, index=True),
        sa.Column("room_id", sa.String(36), sa.ForeignKey("rooms.id"), nullable=True),
        sa.Column("stage_id", sa.String(36), sa.ForeignKey("stages.id"), nullable=False, index=True),
        sa.Column("requested_by", sa.String(36), nullable=True),
        sa.Column("accepted_by", sa.String(36), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(32), server_default="not_requested"),
        sa.Column("checklist_json", sa.Text(), nullable=True),
        sa.Column("quality_score", sa.Float(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )


def upgrade() -> None:
    _ensure_work_acceptances()
    op.create_table(
        "project_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("stage_id", sa.String(36), sa.ForeignKey("stages.id"), nullable=True),
        sa.Column("payment_id", sa.String(36), sa.ForeignKey("payments.id"), nullable=True),
        sa.Column("receipt_id", sa.String(36), sa.ForeignKey("receipts.id"), nullable=True),
        sa.Column("work_acceptance_id", sa.String(36), sa.ForeignKey("work_acceptances.id"), nullable=True),
        sa.Column("document_type", sa.String(32), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("current_version_id", sa.String(36), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_project_documents_project_id", "project_documents", ["project_id"])
    op.create_index("ix_project_documents_stage_id", "project_documents", ["stage_id"])
    op.create_index("ix_project_documents_payment_id", "project_documents", ["payment_id"])
    op.create_index("ix_project_documents_work_acceptance_id", "project_documents", ["work_acceptance_id"])
    op.create_index("ix_project_documents_document_type", "project_documents", ["document_type"])
    op.create_index("ix_project_documents_status", "project_documents", ["status"])

    op.create_table(
        "document_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("project_documents.id"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(512), nullable=True),
        sa.Column("mime_type", sa.String(128), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("href", sa.String(1024), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"])

    op.create_table(
        "document_signatures",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("project_documents.id"), nullable=False),
        sa.Column("version_id", sa.String(36), sa.ForeignKey("document_versions.id"), nullable=False),
        sa.Column("signer_user_id", sa.String(36), nullable=False),
        sa.Column("signer_role", sa.String(32), nullable=False),
        sa.Column("signature_type", sa.String(32), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("signed_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("meta_json", sa.Text(), nullable=True),
    )
    op.create_index("ix_document_signatures_document_id", "document_signatures", ["document_id"])
    op.create_index("ix_document_signatures_version_id", "document_signatures", ["version_id"])
    op.create_index("ix_document_signatures_signer_user_id", "document_signatures", ["signer_user_id"])


def downgrade() -> None:
    op.drop_table("document_signatures")
    op.drop_table("document_versions")
    op.drop_table("project_documents")
