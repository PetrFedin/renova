"""room floor_level

Revision ID: b2c3d4e5f6a7
"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table('rooms') as batch:
        batch.add_column(sa.Column('floor_level', sa.Integer(), nullable=False, server_default='1'))

def downgrade():
    with op.batch_alter_table('rooms') as batch:
        batch.drop_column('floor_level')
