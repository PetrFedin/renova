"""a stage the project does not need can be skipped

Этап можно было создать, запустить, сдать и принять — но нельзя ни удалить,
ни пропустить. Между тем часть этапов типового набора конкретному объекту не
нужна: если в квартире не трогают полы, «Стяжка» висит вечно на нуле и тянет
прогресс проекта вниз.

Пропуск, а не удаление, потому что на этап ссылаются двенадцать таблиц —
комментарии, фото, оплаты, чеки, позиции закупок, подборы материалов,
замечания, зависимости, приёмки, строки бюджета, расходы и наряды. Пропущенный
этап остаётся в истории и возвращается обратно одним действием.

Revision ID: w29stageskip01
Revises: w22projectparticipants01
Create Date: 2026-09-18
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "w29stageskip01"
down_revision: str | None = "w22projectparticipants01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("stages", "skipped_at"):
        op.add_column("stages", sa.Column("skipped_at", sa.DateTime(), nullable=True))
    if not _has_column("stages", "skipped_reason"):
        op.add_column(
            "stages", sa.Column("skipped_reason", sa.String(length=255), nullable=True)
        )
    if not _has_column("stages", "skipped_by"):
        op.add_column("stages", sa.Column("skipped_by", sa.String(length=36), nullable=True))
        op.create_foreign_key(
            "fk_stages_skipped_by", "stages", "users", ["skipped_by"], ["id"]
        )


def downgrade() -> None:
    if _has_column("stages", "skipped_by"):
        op.drop_constraint("fk_stages_skipped_by", "stages", type_="foreignkey")
        op.drop_column("stages", "skipped_by")
    if _has_column("stages", "skipped_reason"):
        op.drop_column("stages", "skipped_reason")
    if _has_column("stages", "skipped_at"):
        op.drop_column("stages", "skipped_at")
