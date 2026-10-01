"""Change-order link columns, lead close reason, private lead threads (MNY-020, MKT-005, MKT-010)

* change_orders.stage_id (nullable FK stages, ON DELETE SET NULL)
* payments.change_order_id (nullable FK change_orders, ON DELETE SET NULL, indexed);
  existing invoices carrying the legacy ``CO:<id>;`` notes marker are linked by
  column and the marker is stripped from notes (restored on downgrade).
* job_leads.closed_reason / closed_at
* lead_messages.thread_contractor_id (nullable FK users, indexed); legacy
  messages belong to the assigned contractor's thread.

Revision ID: x06coinvoicelink01
Revises: x05teaminviteinvitee01
"""

from alembic import op
import sqlalchemy as sa


revision = "x06coinvoicelink01"
down_revision = "x05teaminviteinvitee01"
branch_labels = None
depends_on = None

_MARKER_PREFIX = "CO:"


def _parse_marker(notes: str | None) -> tuple[str, str] | None:
    """`CO:<id>; rest` -> (id, rest). None when there is no well-formed marker."""
    if not notes or not notes.startswith(_MARKER_PREFIX) or ";" not in notes:
        return None
    head, rest = notes.split(";", 1)
    order_id = head[len(_MARKER_PREFIX):].strip()
    if not order_id:
        return None
    return order_id, rest.strip()


def backfill_change_order_links(connection) -> int:
    """Marker in payments.notes -> payments.change_order_id. Safe without markers."""
    order_ids = {row[0] for row in connection.execute(sa.text("SELECT id FROM change_orders"))}
    if not order_ids:
        return 0
    rows = connection.execute(
        sa.text(
            "SELECT id, notes FROM payments "
            "WHERE change_order_id IS NULL AND notes LIKE 'CO:%;%'"
        )
    ).fetchall()
    linked = 0
    for payment_id, notes in rows:
        parsed = _parse_marker(notes)
        if not parsed or parsed[0] not in order_ids:
            continue
        order_id, rest = parsed
        connection.execute(
            sa.text("UPDATE payments SET change_order_id = :oid, notes = :notes WHERE id = :pid"),
            {"oid": order_id, "notes": rest or None, "pid": payment_id},
        )
        linked += 1
    return linked


def restore_change_order_markers(connection) -> None:
    rows = connection.execute(
        sa.text("SELECT id, change_order_id, notes FROM payments WHERE change_order_id IS NOT NULL")
    ).fetchall()
    for payment_id, order_id, notes in rows:
        connection.execute(
            sa.text("UPDATE payments SET notes = :notes WHERE id = :pid"),
            {"notes": f"{_MARKER_PREFIX}{order_id}; {notes or ''}".rstrip(), "pid": payment_id},
        )


def backfill_lead_threads(connection) -> None:
    """Legacy messages (assigned-contractor-only chat) -> the assigned contractor's thread."""
    connection.execute(
        sa.text(
            "UPDATE lead_messages SET thread_contractor_id = ("
            "SELECT job_leads.assigned_contractor_id FROM job_leads "
            "WHERE job_leads.id = lead_messages.lead_id) "
            "WHERE thread_contractor_id IS NULL"
        )
    )


def upgrade() -> None:
    op.add_column("change_orders", sa.Column("stage_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_change_orders_stage_id", "change_orders", "stages", ["stage_id"], ["id"], ondelete="SET NULL"
    )
    op.add_column("payments", sa.Column("change_order_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_payments_change_order_id", "payments", "change_orders", ["change_order_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_payments_change_order_id", "payments", ["change_order_id"])

    op.add_column("job_leads", sa.Column("closed_reason", sa.Text(), nullable=True))
    op.add_column("job_leads", sa.Column("closed_at", sa.DateTime(), nullable=True))

    op.add_column("lead_messages", sa.Column("thread_contractor_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_lead_messages_thread_contractor_id", "lead_messages", "users",
        ["thread_contractor_id"], ["id"],
    )
    op.create_index("ix_lead_messages_thread_contractor_id", "lead_messages", ["thread_contractor_id"])

    connection = op.get_bind()
    backfill_change_order_links(connection)
    backfill_lead_threads(connection)


def downgrade() -> None:
    connection = op.get_bind()
    restore_change_order_markers(connection)

    op.drop_index("ix_lead_messages_thread_contractor_id", table_name="lead_messages")
    op.drop_constraint("fk_lead_messages_thread_contractor_id", "lead_messages", type_="foreignkey")
    op.drop_column("lead_messages", "thread_contractor_id")

    op.drop_column("job_leads", "closed_at")
    op.drop_column("job_leads", "closed_reason")

    op.drop_index("ix_payments_change_order_id", table_name="payments")
    op.drop_constraint("fk_payments_change_order_id", "payments", type_="foreignkey")
    op.drop_column("payments", "change_order_id")

    op.drop_constraint("fk_change_orders_stage_id", "change_orders", type_="foreignkey")
    op.drop_column("change_orders", "stage_id")
