from fastapi import APIRouter
from app.api.v1 import portal
from app.api.v1 import selections
from app.api.v1 import (
    auth, activity, scratchpad, chat_inbox, work_orders, work_acceptances,
    budget_planner, purchases, documents, esign, ocr_worker, os, reports, marketplace, design_packages,
    approvals, waste_orders, floor_plans, work_types, materials, rework_sla, kpi_history,
    project_checklists, checklist_templates, stage_reactions, articles, analytics, admin,
    audit, subscription, teams, export, push, articles_admin, calendar, change_orders,
    chats, estimate, fns, media, notifications, payments, projects, receipts, room_requests,
    rooms, stages_ext, project_work_schedule,
)

api_router = APIRouter(prefix="/api/v1")

# --- content / design ---
api_router.include_router(design_packages.router)
api_router.include_router(marketplace.router)
api_router.include_router(materials.router)
api_router.include_router(selections.router)
api_router.include_router(approvals.router)
api_router.include_router(waste_orders.router)
api_router.include_router(floor_plans.router)
api_router.include_router(work_types.router)

# --- project execution ---
api_router.include_router(work_orders.router)
api_router.include_router(work_acceptances.router)
api_router.include_router(budget_planner.router)
api_router.include_router(activity.router)
api_router.include_router(rework_sla.router)
api_router.include_router(project_work_schedule.router)
api_router.include_router(stages_ext.router)
api_router.include_router(project_checklists.router)
api_router.include_router(checklist_templates.router)
api_router.include_router(stage_reactions.router)
api_router.include_router(documents.router)
api_router.include_router(esign.router)
api_router.include_router(ocr_worker.router)
api_router.include_router(os.router)
api_router.include_router(portal.router)
api_router.include_router(reports.router)

# --- core / identity ---
api_router.include_router(auth.router)
api_router.include_router(push.router)
api_router.include_router(subscription.router)
api_router.include_router(teams.router)
api_router.include_router(analytics.router)
api_router.include_router(audit.router)
api_router.include_router(admin.router)
api_router.include_router(articles.router)
api_router.include_router(articles_admin.router)
api_router.include_router(fns.router)
api_router.include_router(kpi_history.router)
api_router.include_router(notifications.router)
api_router.include_router(media.router)
api_router.include_router(projects.router)
api_router.include_router(rooms.router)
api_router.include_router(room_requests.router)
api_router.include_router(calendar.router)
api_router.include_router(chat_inbox.router)
api_router.include_router(chats.router)

# --- finance ---
api_router.include_router(payments.router)
api_router.include_router(estimate.router)
api_router.include_router(change_orders.router)
api_router.include_router(export.router)
api_router.include_router(receipts.router)
api_router.include_router(purchases.router)

# --- misc ---
api_router.include_router(scratchpad.router)