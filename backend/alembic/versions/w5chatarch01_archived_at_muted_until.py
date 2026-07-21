"""chat_thread_reads: archived_at + muted_until (archive ≠ mute ≠ read)

Revision ID: w5chatarch01
Revises: w4jtipurge01
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "w5chatarch01"
down_revision: Union[str, Sequence[str], None] = "w4jtipurge01"
branch_labels = None
depends_on = None


def _cols(name: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(name)}


def upgrade() -> None:
    if "chat_thread_reads" not in sa.inspect(op.get_bind()).get_table_names():
        return
    cols = _cols("chat_thread_reads")
    if "archived_at" not in cols:
        op.add_column("chat_thread_reads", sa.Column("archived_at", sa.DateTime(), nullable=True))
    if "muted_until" not in cols:
        op.add_column("chat_thread_reads", sa.Column("muted_until", sa.DateTime(), nullable=True))


def downgrade() -> None:
    if "chat_thread_reads" not in sa.inspect(op.get_bind()).get_table_names():
        return
    cols = _cols("chat_thread_reads")
    if "muted_until" in cols:
        op.drop_column("chat_thread_reads", "muted_until")
    if "archived_at" in cols:
        op.drop_column("chat_thread_reads", "archived_at")
