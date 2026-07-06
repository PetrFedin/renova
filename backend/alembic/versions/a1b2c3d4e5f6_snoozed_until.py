"""add snoozed_until to app_notifications

Revision ID: a1b2c3d4e5f6
Revises: 14ef20b1cf11
Create Date: 2026-06-28
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '14ef20b1cf11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('app_notifications', schema=None) as batch_op:
        batch_op.add_column(sa.Column('snoozed_until', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('app_notifications', schema=None) as batch_op:
        batch_op.drop_column('snoozed_until')
