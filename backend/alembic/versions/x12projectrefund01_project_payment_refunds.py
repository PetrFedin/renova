"""Durable project-payment provider partial/full refund ledger (#748).

Revision ID: x12projectrefund01
Revises: x11portalacceptscope01
"""
from alembic import op
from decimal import Decimal
from uuid import uuid4
import sqlalchemy as sa

revision = "x12projectrefund01"
down_revision = "x11portalacceptscope01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_payment_refunds",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("payment_id", sa.String(length=36), nullable=False),
        sa.Column("provider_payment_id", sa.String(length=128), nullable=False),
        sa.Column("provider_refund_id", sa.String(length=128), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_project_payment_refund_positive"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["payment_id"], ["payments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_refund_id", name="uq_project_payment_refunds_provider_refund_id"),
    )
    op.create_index(
        "ix_project_payment_refunds_project_id", "project_payment_refunds", ["project_id"]
    )
    op.create_index(
        "ix_project_payment_refunds_payment_id", "project_payment_refunds", ["payment_id"]
    )
    op.create_index(
        "ix_project_payment_refunds_provider_payment_id",
        "project_payment_refunds", ["provider_payment_id"]
    )

    # Historical full reversals predate the explicit refund ledger. The prior
    # canonical service accepted only full refunds, recorded one PaymentEvent
    # (evidence_ref = external refund ID) and set Payment.status=refunded.
    # Backfill only those proof-bound records. Unknown/ambiguous legacy refunds
    # FAIL migration rather than fabricating a provider identity or net balance.
    bind = op.get_bind()
    historical = list(bind.execute(sa.text(
        """
        SELECT p.id AS payment_id, p.project_id,
               p.yookassa_payment_id AS provider_payment_id,
               p.amount AS amount,
               ev.evidence_ref AS provider_refund_id,
               ev.created_at AS created_at
          FROM payments p
          JOIN payment_events ev ON ev.payment_id = p.id
         WHERE p.status = 'refunded'
           AND ev.evidence_type = 'yookassa_refund'
           AND ev.new_status = 'refunded'
        """
    )).mappings())
    expected_count = bind.execute(sa.text(
        "SELECT COUNT(*) FROM payments WHERE status = 'refunded'"
    )).scalar_one()
    if len(historical) != expected_count:
        raise RuntimeError(
            "project_refund_legacy_backfill_ambiguous: "
            "refunded payment missing or repeating provider refund event"
        )
    refund_ids: set[str] = set()
    payment_ids: set[str] = set()
    for row in historical:
        rid = str(row["provider_refund_id"] or "").strip()
        provider = str(row["provider_payment_id"] or "").strip()
        amount = Decimal(str(row["amount"] or 0))
        if (
            not rid or len(rid) > 128
            or not provider or len(provider) > 128
            or rid in refund_ids
            or row["payment_id"] in payment_ids
            or amount <= 0
            or amount != amount.quantize(Decimal("0.01"))
            or row["created_at"] is None
        ):
            raise RuntimeError(
                "project_refund_legacy_backfill_invalid_evidence"
            )
        refund_ids.add(rid)
        payment_ids.add(row["payment_id"])
        bind.execute(sa.text(
            """
            INSERT INTO project_payment_refunds
              (id, project_id, payment_id, provider_payment_id,
               provider_refund_id, amount, currency, created_at)
            VALUES
              (:id, :project_id, :payment_id, :provider_payment_id,
               :provider_refund_id, :amount, 'RUB', :created_at)
            """
        ), {
            "id": str(uuid4()),
            "project_id": row["project_id"],
            "payment_id": row["payment_id"],
            "provider_payment_id": provider,
            "provider_refund_id": rid,
            "amount": amount,
            "created_at": row["created_at"],
        })


def downgrade() -> None:
    op.drop_index("ix_project_payment_refunds_provider_payment_id", table_name="project_payment_refunds")
    op.drop_index("ix_project_payment_refunds_payment_id", table_name="project_payment_refunds")
    op.drop_index("ix_project_payment_refunds_project_id", table_name="project_payment_refunds")
    op.drop_table("project_payment_refunds")
