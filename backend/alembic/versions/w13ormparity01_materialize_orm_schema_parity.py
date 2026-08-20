"""materialize ORM table and column parity

Revision ID: w13ormparity01
Revises: w12pushreceipt01

Deliberately additive catch-up for ORM tables/columns that were never
represented in Alembic history. Existing type/nullability/index/unique
autogenerate proposals are intentionally excluded from this revision.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "w13ormparity01"
down_revision: Union[str, Sequence[str], None] = "w12pushreceipt01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('audit_logs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('method', sa.String(length=8), nullable=False),
    sa.Column('path', sa.String(length=512), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_logs_created_at'), 'audit_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_audit_logs_user_id'), 'audit_logs', ['user_id'], unique=False)
    op.create_table('checklist_template_versions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('template_id', sa.String(length=36), nullable=False),
    sa.Column('scope', sa.String(length=16), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('items_json', sa.Text(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_checklist_template_versions_template_id'), 'checklist_template_versions', ['template_id'], unique=False)
    op.create_table('checklist_templates',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('items_json', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_checklist_templates_user_id'), 'checklist_templates', ['user_id'], unique=False)
    op.create_table('subscriptions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('status', sa.Enum('free', 'active', name='subscriptionstatus'), nullable=False),
    sa.Column('plan', sa.String(length=32), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('teams',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('owner_id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_teams_owner_id'), 'teams', ['owner_id'], unique=False)
    op.create_table('activity_events',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=True),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('room_id', sa.String(length=36), nullable=True),
    sa.Column('work_type', sa.String(length=64), nullable=True),
    sa.Column('link_path', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_activity_events_created_at'), 'activity_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_activity_events_kind'), 'activity_events', ['kind'], unique=False)
    op.create_index(op.f('ix_activity_events_project_id'), 'activity_events', ['project_id'], unique=False)
    op.create_index(op.f('ix_activity_events_work_type'), 'activity_events', ['work_type'], unique=False)
    op.create_table('contractor_portfolio_photos',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('profile_id', sa.String(length=36), nullable=False),
    sa.Column('image_key', sa.String(length=512), nullable=False),
    sa.Column('caption', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['profile_id'], ['contractor_profiles.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_contractor_portfolio_photos_profile_id'), 'contractor_portfolio_photos', ['profile_id'], unique=False)
    op.create_table('design_packages',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('file_key', sa.String(length=512), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_design_packages_project_id'), 'design_packages', ['project_id'], unique=False)
    op.create_table('lead_messages',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('lead_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['lead_id'], ['job_leads.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_lead_messages_lead_id'), 'lead_messages', ['lead_id'], unique=False)
    op.create_table('margin_snapshots',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('margin_estimated', sa.Float(), nullable=False),
    sa.Column('recorded_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_margin_snapshots_project_id'), 'margin_snapshots', ['project_id'], unique=False)
    op.create_index(op.f('ix_margin_snapshots_recorded_at'), 'margin_snapshots', ['recorded_at'], unique=False)
    op.create_table('project_checklist_templates',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('items_json', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_project_checklist_templates_project_id'), 'project_checklist_templates', ['project_id'], unique=False)
    op.create_table('project_work_schedules',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('status', sa.Enum('draft', 'submitted', 'confirmed', 'rejected', 'archived', name='workschedulestatus'), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('planned_start_date', sa.Date(), nullable=True),
    sa.Column('planned_finish_date', sa.Date(), nullable=True),
    sa.Column('rejection_reason', sa.Text(), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('submitted_by', sa.String(length=36), nullable=True),
    sa.Column('confirmed_by', sa.String(length=36), nullable=True),
    sa.Column('rejected_by', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('submitted_at', sa.DateTime(), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.Column('rejected_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('schedule_version', sa.Integer(), nullable=False),
    sa.Column('supersedes_id', sa.String(length=36), nullable=True),
    sa.ForeignKeyConstraint(['confirmed_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['rejected_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['submitted_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['supersedes_id'], ['project_work_schedules.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_project_work_schedules_created_by'), 'project_work_schedules', ['created_by'], unique=False)
    op.create_index(op.f('ix_project_work_schedules_project_id'), 'project_work_schedules', ['project_id'], unique=False)
    op.create_index(op.f('ix_project_work_schedules_status'), 'project_work_schedules', ['status'], unique=False)
    op.create_index(op.f('ix_project_work_schedules_supersedes_id'), 'project_work_schedules', ['supersedes_id'], unique=False)
    op.create_table('property_floors',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('floor_number', sa.Integer(), nullable=False),
    sa.Column('area_sqm', sa.Float(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_property_floors_project_id'), 'property_floors', ['project_id'], unique=False)
    op.create_table('property_objects',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('object_type', sa.String(length=32), nullable=True),
    sa.Column('total_area_sqm', sa.Float(), nullable=True),
    sa.Column('floors_count', sa.Integer(), nullable=False),
    sa.Column('rooms_count', sa.Integer(), nullable=True),
    sa.Column('ceiling_height_m', sa.Float(), nullable=True),
    sa.Column('build_year', sa.Integer(), nullable=True),
    sa.Column('building_type', sa.String(length=32), nullable=True),
    sa.Column('has_elevator', sa.Boolean(), nullable=False),
    sa.Column('condition_before', sa.String(length=64), nullable=True),
    sa.Column('is_new_build', sa.Boolean(), nullable=False),
    sa.Column('has_demolition', sa.Boolean(), nullable=False),
    sa.Column('has_replanning', sa.Boolean(), nullable=False),
    sa.Column('has_design_project', sa.Boolean(), nullable=False),
    sa.Column('has_contractor', sa.Boolean(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_property_objects_project_id'), 'property_objects', ['project_id'], unique=True)
    op.create_table('scratchpad_lines',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('line_kind', sa.String(length=32), nullable=False),
    sa.Column('done', sa.Boolean(), nullable=False),
    sa.Column('promoted_kind', sa.String(length=32), nullable=True),
    sa.Column('promoted_id', sa.String(length=36), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_scratchpad_lines_project_id'), 'scratchpad_lines', ['project_id'], unique=False)
    op.create_table('team_invites',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('team_id', sa.String(length=36), nullable=False),
    sa.Column('token', sa.String(length=64), nullable=False),
    sa.Column('role', sa.String(length=32), nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=False),
    sa.Column('used', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_team_invites_team_id'), 'team_invites', ['team_id'], unique=False)
    op.create_index(op.f('ix_team_invites_token'), 'team_invites', ['token'], unique=True)
    op.create_table('team_members',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('team_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('team_id', 'user_id', name='uq_team_member')
    )
    op.create_index(op.f('ix_team_members_team_id'), 'team_members', ['team_id'], unique=False)
    op.create_index(op.f('ix_team_members_user_id'), 'team_members', ['user_id'], unique=False)
    op.create_table('project_work_schedule_items',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('schedule_id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('stage_id', sa.String(length=36), nullable=True),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.Enum('planned', 'ready', 'in_progress', 'submitted', 'accepted', 'delayed', 'blocked', 'cancelled', name='workscheduleitemstatus'), nullable=False),
    sa.Column('planned_start_date', sa.Date(), nullable=False),
    sa.Column('planned_finish_date', sa.Date(), nullable=False),
    sa.Column('actual_start_date', sa.Date(), nullable=True),
    sa.Column('actual_finish_date', sa.Date(), nullable=True),
    sa.Column('depends_on_item_id', sa.String(length=36), nullable=True),
    sa.Column('requires_customer_acceptance', sa.Boolean(), nullable=False),
    sa.Column('requires_photo', sa.Boolean(), nullable=False),
    sa.Column('requires_hidden_work_acceptance', sa.Boolean(), nullable=False),
    sa.Column('delay_days', sa.Integer(), nullable=False),
    sa.Column('blocking_reason', sa.Text(), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('progress_percent', sa.Float(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['depends_on_item_id'], ['project_work_schedule_items.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['schedule_id'], ['project_work_schedules.id'], ),
    sa.ForeignKeyConstraint(['stage_id'], ['stages.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_project_work_schedule_items_depends_on_item_id'), 'project_work_schedule_items', ['depends_on_item_id'], unique=False)
    op.create_index(op.f('ix_project_work_schedule_items_project_id'), 'project_work_schedule_items', ['project_id'], unique=False)
    op.create_index(op.f('ix_project_work_schedule_items_schedule_id'), 'project_work_schedule_items', ['schedule_id'], unique=False)
    op.create_index(op.f('ix_project_work_schedule_items_stage_id'), 'project_work_schedule_items', ['stage_id'], unique=False)
    op.create_index(op.f('ix_project_work_schedule_items_status'), 'project_work_schedule_items', ['status'], unique=False)
    op.create_table('budget_alert_sent',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('room_id', sa.String(length=36), nullable=False),
    sa.Column('sent_date', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'room_id', 'sent_date', name='uq_budget_alert_day')
    )
    op.create_index(op.f('ix_budget_alert_sent_room_id'), 'budget_alert_sent', ['room_id'], unique=False)
    op.create_index(op.f('ix_budget_alert_sent_user_id'), 'budget_alert_sent', ['user_id'], unique=False)
    op.create_table('comment_reactions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('comment_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('reaction', sa.String(length=8), nullable=False),
    sa.ForeignKeyConstraint(['comment_id'], ['stage_comments.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('comment_id', 'user_id', name='uq_comment_react')
    )
    op.create_index(op.f('ix_comment_reactions_comment_id'), 'comment_reactions', ['comment_id'], unique=False)
    op.create_table('furniture_items',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('room_id', sa.String(length=36), nullable=True),
    sa.Column('floor_plan_id', sa.String(length=36), nullable=True),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('width_m', sa.Float(), nullable=False),
    sa.Column('depth_m', sa.Float(), nullable=False),
    sa.Column('height_m', sa.Float(), nullable=False),
    sa.Column('x_pct', sa.Float(), nullable=True),
    sa.Column('y_pct', sa.Float(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['floor_plan_id'], ['floor_plans.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_furniture_items_project_id'), 'furniture_items', ['project_id'], unique=False)
    op.create_index(op.f('ix_furniture_items_room_id'), 'furniture_items', ['room_id'], unique=False)
    op.create_table('room_change_logs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('room_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('field_name', sa.String(length=64), nullable=False),
    sa.Column('old_value', sa.String(length=255), nullable=False),
    sa.Column('new_value', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_room_change_logs_room_id'), 'room_change_logs', ['room_id'], unique=False)
    op.create_table('waste_orders',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('room_id', sa.String(length=36), nullable=True),
    sa.Column('volume_m3', sa.Float(), nullable=False),
    sa.Column('waste_type', sa.String(length=64), nullable=False),
    sa.Column('scheduled_date', sa.Date(), nullable=True),
    sa.Column('status', sa.Enum('draft', 'requested', 'scheduled', 'done', 'cancelled', name='wasteorderstatus'), nullable=False),
    sa.Column('price', sa.Float(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_waste_orders_project_id'), 'waste_orders', ['project_id'], unique=False)
    op.create_index(op.f('ix_waste_orders_room_id'), 'waste_orders', ['room_id'], unique=False)
    op.create_table('budget_lines',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('room_id', sa.String(length=36), nullable=True),
    sa.Column('stage_id', sa.String(length=36), nullable=True),
    sa.Column('estimate_line_id', sa.String(length=36), nullable=True),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=False),
    sa.Column('planned_amount', sa.Float(), nullable=False),
    sa.Column('actual_amount', sa.Float(), nullable=False),
    sa.Column('expense_type', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['estimate_line_id'], ['estimate_lines.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
    sa.ForeignKeyConstraint(['stage_id'], ['stages.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_budget_lines_project_id'), 'budget_lines', ['project_id'], unique=False)
    op.create_table('expenses',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('room_id', sa.String(length=36), nullable=True),
    sa.Column('stage_id', sa.String(length=36), nullable=True),
    sa.Column('material_pick_id', sa.String(length=36), nullable=True),
    sa.Column('receipt_id', sa.String(length=36), nullable=True),
    sa.Column('payment_id', sa.String(length=36), nullable=True),
    sa.Column('purchase_id', sa.String(length=36), nullable=True),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('amount', sa.Float(), nullable=False),
    sa.Column('currency', sa.String(length=8), nullable=False),
    sa.Column('payment_method', sa.String(length=32), nullable=True),
    sa.Column('supplier_name', sa.String(length=128), nullable=True),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('expense_date', sa.DateTime(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['payment_id'], ['payments.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['receipt_id'], ['receipts.id'], ),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ),
    sa.ForeignKeyConstraint(['stage_id'], ['stages.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_expenses_project_id'), 'expenses', ['project_id'], unique=False)
    op.create_index(op.f('ix_expenses_status'), 'expenses', ['status'], unique=False)
    op.create_table('work_dependencies',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('stage_id', sa.String(length=36), nullable=False),
    sa.Column('depends_on_stage_id', sa.String(length=36), nullable=True),
    sa.Column('depends_on_material_pick_id', sa.String(length=36), nullable=True),
    sa.Column('dependency_type', sa.String(length=16), nullable=False),
    sa.Column('criticality', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['depends_on_material_pick_id'], ['material_picks.id'], ),
    sa.ForeignKeyConstraint(['depends_on_stage_id'], ['stages.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['stage_id'], ['stages.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_work_dependencies_project_id'), 'work_dependencies', ['project_id'], unique=False)
    op.create_index(op.f('ix_work_dependencies_stage_id'), 'work_dependencies', ['stage_id'], unique=False)

    # Existing tables: add only columns absent from Alembic history.
    op.add_column('projects', sa.Column('estimate_propose_snapshot_json', sa.Text(), nullable=True))
    op.add_column('projects', sa.Column('vat_rate', sa.Float(), nullable=False, server_default=sa.text('0')))

    op.add_column('rooms', sa.Column('floor_id', sa.String(length=36), nullable=True))
    op.add_column('rooms', sa.Column('budget_alert_pct', sa.Float(), nullable=True))
    op.create_index(op.f('ix_rooms_floor_id'), 'rooms', ['floor_id'], unique=False)
    op.create_foreign_key('fk_rooms_floor_id_property_floors', 'rooms', 'property_floors', ['floor_id'], ['id'])

    op.add_column('stages', sa.Column('weight_coefficient', sa.Float(), nullable=False, server_default=sa.text('0')))
    op.add_column('stages', sa.Column('needs_rework', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('stages', sa.Column('ical_uid', sa.String(length=128), nullable=True))
    op.add_column('stages', sa.Column('rework_deadline', sa.DateTime(), nullable=True))
    op.add_column('stages', sa.Column('work_type', sa.String(length=64), nullable=True))
    op.add_column('stages', sa.Column('depends_on_stage_id', sa.String(length=36), nullable=True))
    op.add_column('stages', sa.Column('checklist_json', sa.Text(), nullable=True))
    op.add_column('stages', sa.Column('assignee_id', sa.String(length=36), nullable=True))
    op.add_column('stages', sa.Column('actual_start', sa.Date(), nullable=True))
    op.add_column('stages', sa.Column('actual_end', sa.Date(), nullable=True))
    op.create_index(op.f('ix_stages_assignee_id'), 'stages', ['assignee_id'], unique=False)
    op.create_index(op.f('ix_stages_ical_uid'), 'stages', ['ical_uid'], unique=False)
    op.create_index(op.f('ix_stages_work_type'), 'stages', ['work_type'], unique=False)
    op.create_foreign_key('fk_stages_depends_on_stage_id_stages', 'stages', 'stages', ['depends_on_stage_id'], ['id'])
    op.create_foreign_key('fk_stages_assignee_id_users', 'stages', 'users', ['assignee_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint('fk_stages_assignee_id_users', 'stages', type_='foreignkey')
    op.drop_constraint('fk_stages_depends_on_stage_id_stages', 'stages', type_='foreignkey')
    op.drop_index(op.f('ix_stages_work_type'), table_name='stages')
    op.drop_index(op.f('ix_stages_ical_uid'), table_name='stages')
    op.drop_index(op.f('ix_stages_assignee_id'), table_name='stages')
    for column in (
        'actual_end', 'actual_start', 'assignee_id', 'checklist_json',
        'depends_on_stage_id', 'work_type', 'rework_deadline', 'ical_uid',
        'needs_rework', 'weight_coefficient',
    ):
        op.drop_column('stages', column)

    op.drop_constraint('fk_rooms_floor_id_property_floors', 'rooms', type_='foreignkey')
    op.drop_index(op.f('ix_rooms_floor_id'), table_name='rooms')
    op.drop_column('rooms', 'budget_alert_pct')
    op.drop_column('rooms', 'floor_id')
    op.drop_column('projects', 'vat_rate')
    op.drop_column('projects', 'estimate_propose_snapshot_json')
    op.drop_table('work_dependencies')
    op.drop_table('expenses')
    op.drop_table('budget_lines')
    op.drop_table('waste_orders')
    op.drop_table('room_change_logs')
    op.drop_table('furniture_items')
    op.drop_table('comment_reactions')
    op.drop_table('budget_alert_sent')
    op.drop_table('project_work_schedule_items')
    op.drop_table('team_members')
    op.drop_table('team_invites')
    op.drop_table('scratchpad_lines')
    op.drop_table('property_objects')
    op.drop_table('property_floors')
    op.drop_table('project_work_schedules')
    op.drop_table('project_checklist_templates')
    op.drop_table('margin_snapshots')
    op.drop_table('lead_messages')
    op.drop_table('design_packages')
    op.drop_table('contractor_portfolio_photos')
    op.drop_table('activity_events')
    op.drop_table('teams')
    op.drop_table('subscriptions')
    op.drop_table('checklist_templates')
    op.drop_table('checklist_template_versions')
    op.drop_table('audit_logs')


    for enum_name in (
        'wasteorderstatus',
        'workscheduleitemstatus',
        'workschedulestatus',
        'subscriptionstatus',
    ):
        postgresql.ENUM(name=enum_name).drop(op.get_bind(), checkfirst=True)
