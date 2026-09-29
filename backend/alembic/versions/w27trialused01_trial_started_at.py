"""durable record that a contractor's trial was used

H1.1 — один trial на исполнителя. Факт использования хранился в изменяемой
строке `subscriptions.plan`: trial → "trial_used". Но `activate_pro` пишет в ту
же колонку "pro", а истечение Pro пишет "free" — и признак исчезает. После
одного оплаченного месяца исполнитель снова получал бесплатные 14 дней, и так
сколько угодно раз.

Факт из прошлого не должен жить в поле, описывающем настоящее.

Revision ID: w27trialused01
Revises: w22projectparticipants01
Create Date: 2026-09-18
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w27trialused01"
down_revision: str | None = "w22projectparticipants01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if _has_column("subscriptions", "trial_started_at"):
        return
    op.add_column(
        "subscriptions", sa.Column("trial_started_at", sa.DateTime(), nullable=True)
    )

    # Backfill: у всех, чей текущий plan ещё помнит триал, признак сохраняем.
    # Точной даты старта в базе нет, поэтому берём то, что ближе всего к правде:
    # для активного триала — конец минус 14 дней, иначе конец периода, иначе
    # «когда-то» — важна не дата, а сам факт.
    op.execute(
        """
        UPDATE subscriptions
           SET trial_started_at = COALESCE(expires_at, CURRENT_TIMESTAMP)
         WHERE plan IN ('trial', 'trial_used')
           AND trial_started_at IS NULL
        """
    )


def downgrade() -> None:
    if _has_column("subscriptions", "trial_started_at"):
        op.drop_column("subscriptions", "trial_started_at")
