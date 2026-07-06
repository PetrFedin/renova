"""project_viewers + viewer role
Revision ID: f6a7b8c9d0e1
"""
from alembic import op
import sqlalchemy as sa

revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'

def upgrade():
    op.create_table(
        'project_viewers',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('project_id', 'user_id', name='uq_project_viewer'),
    )
    op.create_index('ix_project_viewers_user_id', 'project_viewers', ['user_id'])

def downgrade():
    op.drop_table('project_viewers')
