"""receipt stage_id
Revision ID: e5f6a7b8c9d0
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'

def upgrade():
    with op.batch_alter_table('receipts') as batch:
        batch.add_column(sa.Column('stage_id', sa.String(36), nullable=True))

def downgrade():
    with op.batch_alter_table('receipts') as batch:
        batch.drop_column('stage_id')
