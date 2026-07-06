"""stage room_ids_json
Revision ID: c3d4e5f6a7b8
"""
from alembic import op
import sqlalchemy as sa
revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None
def upgrade():
    with op.batch_alter_table('stages') as batch:
        batch.add_column(sa.Column('room_ids_json', sa.Text(), nullable=True))
def downgrade():
    with op.batch_alter_table('stages') as batch:
        batch.drop_column('room_ids_json')
