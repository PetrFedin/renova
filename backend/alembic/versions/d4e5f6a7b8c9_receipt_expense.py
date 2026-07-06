"""receipt expense_category
Revision ID: d4e5f6a7b8c9
"""
from alembic import op
import sqlalchemy as sa
revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None
def upgrade():
    with op.batch_alter_table('receipts') as batch:
        batch.add_column(sa.Column('expense_category', sa.String(32), nullable=False, server_default='materials'))
        batch.add_column(sa.Column('room_id', sa.String(36), nullable=True))
def downgrade():
    with op.batch_alter_table('receipts') as batch:
        batch.drop_column('room_id')
        batch.drop_column('expense_category')
