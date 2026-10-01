"""Align DB schema with models: NOT NULL, missing FKs and indexes (APIB-039)

Closes the 39 model-vs-migration differences measured by
``scripts/schema_drift_report.py`` (see docs/audit-map/closure/schema-drift.md).

Data safety:
* NOT NULL: NULLs are first backfilled with the model's Python default
  (timestamps -> now() UTC, qty -> 1, prices/totals/budgets/attempts -> 0,
  unit -> 'шт', statuses -> model default). Rows with a value are untouched.
* Foreign keys: orphan references are set to NULL first (columns are nullable);
  the constraints are NO ACTION, exactly as the models declare them
  (stage deletion nulls receipts.stage_id in code).
* Indexes: plain ``CREATE INDEX IF NOT EXISTS``.
Downgrade drops the indexes/FKs and relaxes NOT NULL again; backfilled values stay
(they are valid data and cannot be told from the originals).

Revision ID: x08schemadrift01
Revises: x06coinvoicelink01
"""
from alembic import op
import sqlalchemy as sa


revision = "x08schemadrift01"
down_revision = "x06coinvoicelink01"
branch_labels = None
depends_on = None

_NOW = "timezone('utc', now())"

# table -> {column: SQL backfill literal}
_NOT_NULL: dict[str, dict[str, str]] = {
    "chat_thread_reads": {"created_at": _NOW, "last_read_at": _NOW, "updated_at": _NOW},
    "contractor_profiles": {"created_at": _NOW},
    "document_versions": {"created_at": _NOW},
    "domain_outbox": {"attempts": "0", "created_at": _NOW},
    "floor_plans": {"created_at": _NOW},
    "job_lead_quotes": {"created_at": _NOW},
    "job_leads": {"created_at": _NOW},
    "material_picks": {
        "created_at": _NOW, "price": "0", "qty": "1", "qty_delivered": "0",
        "status": "'draft'", "unit": "'шт'", "updated_at": _NOW,
    },
    "project_documents": {"created_at": _NOW},
    "project_issues": {"created_at": _NOW},
    "purchase_items": {"qty": "1", "unit": "'шт'", "unit_price": "0"},
    "purchases": {"created_at": _NOW, "total_amount": "0", "updated_at": _NOW},
    "selection_items": {"created_at": _NOW, "updated_at": _NOW},
    "suppliers": {"created_at": _NOW},
    "work_acceptances": {"created_at": _NOW, "status": "'not_requested'"},
    "work_orders": {"budget_planned": "0", "budget_spent": "0"},
}

# (table, column, ref table, constraint name)
_FKS = [
    ("material_picks", "analog_of_id", "material_picks", "fk_material_picks_analog_of_id"),
    ("receipts", "room_id", "rooms", "fk_receipts_room_id"),
    ("receipts", "stage_id", "stages", "fk_receipts_stage_id"),
]

_INDEXES = [
    ("ix_material_picks_stage_id", "material_picks", "stage_id"),
    ("ix_material_picks_work_type", "material_picks", "work_type"),
    ("ix_project_viewers_project_id", "project_viewers", "project_id"),
    ("ix_work_acceptances_status", "work_acceptances", "status"),
]


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if not _is_pg():
        return
    for table, cols in _NOT_NULL.items():
        for col, value in cols.items():
            op.execute(sa.text(f'UPDATE "{table}" SET "{col}" = {value} WHERE "{col}" IS NULL'))
            op.alter_column(table, col, nullable=False)
    for table, col, ref, name in _FKS:
        op.execute(sa.text(
            f'UPDATE "{table}" SET "{col}" = NULL WHERE "{col}" IS NOT NULL '
            f'AND "{col}" NOT IN (SELECT id FROM "{ref}")'
        ))
        op.create_foreign_key(name, table, ref, [col], ["id"])
    for name, table, col in _INDEXES:
        op.execute(sa.text(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ("{col}")'))


def downgrade() -> None:
    if not _is_pg():
        return
    for name, _table, _col in _INDEXES:
        op.execute(sa.text(f'DROP INDEX IF EXISTS "{name}"'))
    for table, _col, _ref, name in _FKS:
        op.drop_constraint(name, table, type_="foreignkey")
    for table, cols in _NOT_NULL.items():
        for col in cols:
            op.alter_column(table, col, nullable=True)
