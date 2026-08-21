from fastapi import APIRouter
from app.api.v1 import portal
from app.api.v1 import portal_acceptance_decisions
from app.api.v1 import portal_change_order_decisions
from app.api.v1 import account_lifecycle
from app.api.v1 import document_lifecycle
from app.api.v1 import selections
from app.api.v1 import bank_statements
from app.api.v1 import expense_mutations
from app.api.v1 import material_price_sync
from app.api.v1 import payment_disputes
from app.api.v1 import payment_history
from app.api.v1 import payment_checkout_integrity
from app.api.v1 import subscription_integrity
from app.api.v1 import admin_subscription_refunds
from app.api.v1 import project_creation
from app.api.v1 import stage_mutations
from app.api.v1 import stage_review_transitions
from app.api.v1 import otp_auth
from app.api.v1 import calendar_integrity
from app.api.v1 import calendar_mutations
from app.api.v1 import technical_supervision
from app.api.v1 import technical_supervision_actions
from app.api.v1 import technical_supervision_chat
from app.api.v1 import technical_supervision_schedule
from app.api.v1 import (
    auth, activity, scratchpad, chat_inbox, work_orders, work_acceptances,
    budget_planner, purchases, documents, esign, ocr_worker, automation_worker, os, reports, marketplace, design_packages,
    approvals, waste_orders, floor_plans, work_types, materials, rework_sla, kpi_history,
    project_checklists, checklist_templates, stage_reactions, articles, analytics, admin,
    audit, subscription, teams, export, push, articles_admin, calendar, change_orders,
    chats, estimate, fns, media, notifications, payments, projects, receipts, room_requests,
    rooms, stages_ext, project_work_schedule, issue_transitions,
)

api_router = APIRouter(prefix="/api/v1")

RouteSignature = tuple[str, str]


def _remove_replaced_routes(router: APIRouter, signatures: set[RouteSignature]) -> None:
    """Remove legacy handlers that would otherwise shadow canonical routes."""

    def is_replaced(route) -> bool:
        path = getattr(route, "path", None)
        methods = set(getattr(route, "methods", set()) or set())
        return any(path == target_path and method in methods for target_path, method in signatures)

    router.routes[:] = [route for route in router.routes if not is_replaced(route)]


# --- content / design ---
api_router.include_router(design_packages.router)
api_router.include_router(marketplace.router)

_MATERIAL_PRICE_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/material-picks/{pick_id}/sync-price", "POST"),
}
_remove_replaced_routes(materials.router, _MATERIAL_PRICE_ROUTES)
api_router.include_router(material_price_sync.router)
api_router.include_router(materials.router)
api_router.include_router(selections.router)
api_router.include_router(approvals.router)
api_router.include_router(waste_orders.router)
api_router.include_router(floor_plans.router)
api_router.include_router(work_types.router)

# --- project execution ---
api_router.include_router(work_orders.router)
api_router.include_router(work_acceptances.router)
api_router.include_router(issue_transitions.router)
api_router.include_router(budget_planner.router)
api_router.include_router(activity.router)
api_router.include_router(rework_sla.router)

_TECHNICAL_SUPERVISION_SCHEDULE_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/work-schedules/{schedule_id}/reject", "POST"),
}
_remove_replaced_routes(project_work_schedule.router, _TECHNICAL_SUPERVISION_SCHEDULE_ROUTES)
api_router.include_router(technical_supervision_schedule.router)
api_router.include_router(project_work_schedule.router)

_STAGE_MUTATION_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/stages", "POST"),
    ("/projects/{project_id}/stages/{stage_id}/start", "POST"),
    ("/projects/{project_id}/stages/{stage_id}/ready", "POST"),
    ("/projects/{project_id}/stages/{stage_id}/dates", "PATCH"),
    ("/projects/{project_id}/stages/{stage_id}/rooms", "PATCH"),
    ("/projects/{project_id}/stages/{stage_id}/work-type", "PATCH"),
    ("/projects/{project_id}/stages/{stage_id}/depends", "PATCH"),
    ("/projects/{project_id}/dependencies/sync", "POST"),
}
_remove_replaced_routes(stages_ext.router, _STAGE_MUTATION_ROUTES)
api_router.include_router(stage_mutations.router)
api_router.include_router(stages_ext.router)
api_router.include_router(project_checklists.router)
api_router.include_router(checklist_templates.router)
api_router.include_router(stage_reactions.router)

_DOCUMENT_LIFECYCLE_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/documents/{document_id}/sign", "POST"),
    ("/projects/{project_id}/documents/{document_id}/archive", "POST"),
    ("/projects/{project_id}/documents/{document_id}/restore", "POST"),
    ("/projects/{project_id}/documents/{document_id}", "DELETE"),
    ("/projects/{project_id}/documents/{document_id}/legal-hold", "POST"),
}
_remove_replaced_routes(documents.router, _DOCUMENT_LIFECYCLE_ROUTES)
api_router.include_router(document_lifecycle.router)
api_router.include_router(documents.router)
api_router.include_router(esign.router)
api_router.include_router(ocr_worker.router)
api_router.include_router(automation_worker.router)

_EXPENSE_MUTATION_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/os/expenses/{expense_id}", "PATCH"),
    ("/projects/{project_id}/os/expenses/{expense_id}", "DELETE"),
}
_remove_replaced_routes(os.router, _EXPENSE_MUTATION_ROUTES)
api_router.include_router(expense_mutations.router)
api_router.include_router(os.router)

_PORTAL_CHANGE_ORDER_ROUTES: set[RouteSignature] = {
    ("/portal/projects/{project_id}/change-orders/{order_id}/approve", "POST"),
    ("/portal/projects/{project_id}/change-orders/{order_id}/reject", "POST"),
}
_PORTAL_ACCEPTANCE_ROUTES: set[RouteSignature] = {
    ("/portal/projects/{project_id}/work-acceptances/{acceptance_id}/accept", "POST"),
    ("/portal/projects/{project_id}/work-acceptances/{acceptance_id}/return", "POST"),
}
_remove_replaced_routes(portal.router, _PORTAL_CHANGE_ORDER_ROUTES | _PORTAL_ACCEPTANCE_ROUTES)
api_router.include_router(portal_change_order_decisions.router)
api_router.include_router(portal_acceptance_decisions.router)
api_router.include_router(portal.router)
api_router.include_router(reports.router)

# --- core / identity ---
_ACCOUNT_LIFECYCLE_ROUTES: set[RouteSignature] = {
    ("/auth/anonymize", "POST"),
    ("/auth/me", "DELETE"),
    ("/auth/sessions/revoke-all", "POST"),
    ("/auth/admin/purge-deleted-accounts", "POST"),
}
_OTP_AUTH_ROUTES: set[RouteSignature] = {
    ("/auth/sms/send", "POST"),
    ("/auth/sms/verify", "POST"),
}
_remove_replaced_routes(auth.router, _ACCOUNT_LIFECYCLE_ROUTES | _OTP_AUTH_ROUTES)
api_router.include_router(account_lifecycle.router)
api_router.include_router(otp_auth.router)
api_router.include_router(auth.router)
api_router.include_router(push.router)
_SUBSCRIPTION_INTEGRITY_ROUTES: set[RouteSignature] = {
    ("/subscription/checkout", "POST"),
    ("/subscription/webhook", "POST"),
}
_remove_replaced_routes(subscription.router, _SUBSCRIPTION_INTEGRITY_ROUTES)
api_router.include_router(subscription_integrity.router)
api_router.include_router(subscription.router)
api_router.include_router(teams.router)
api_router.include_router(analytics.router)
api_router.include_router(audit.router)
api_router.include_router(admin_subscription_refunds.router)
api_router.include_router(admin.router)
# Static /articles/admin routes must precede the dynamic /articles/{slug} route.
api_router.include_router(articles_admin.router)
api_router.include_router(articles.router)
api_router.include_router(fns.router)
api_router.include_router(kpi_history.router)
api_router.include_router(notifications.router)
api_router.include_router(media.router)

_PROJECT_CREATION_ROUTES: set[RouteSignature] = {
    ("/projects", "POST"),
    ("/projects/from-template", "POST"),
}
_STAGE_REVIEW_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/stages/{stage_id}/submit", "POST"),
    ("/projects/{project_id}/stages/{stage_id}/reject", "POST"),
}
_remove_replaced_routes(
    projects.router,
    _PROJECT_CREATION_ROUTES | _STAGE_REVIEW_ROUTES,
)
api_router.include_router(project_creation.router)
api_router.include_router(stage_review_transitions.router)
# Keep existing static/legacy project routes before the canonical dynamic reader.
api_router.include_router(projects.router)
api_router.include_router(technical_supervision.router)
api_router.include_router(technical_supervision_actions.router)
api_router.include_router(rooms.router)
api_router.include_router(room_requests.router)
api_router.include_router(calendar_integrity.router)
api_router.include_router(calendar_mutations.router)
api_router.include_router(calendar.router)
api_router.include_router(chat_inbox.router)

_TECHNICAL_SUPERVISION_CHAT_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/chats/{thread_id}/messages", "POST"),
}
_remove_replaced_routes(chats.router, _TECHNICAL_SUPERVISION_CHAT_ROUTES)
api_router.include_router(technical_supervision_chat.router)
api_router.include_router(chats.router)

# --- finance ---
api_router.include_router(payment_disputes.router)

_PAYMENT_HISTORY_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/payments", "GET"),
}
_PAYMENT_CHECKOUT_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/payments/{payment_id}/yookassa-checkout", "POST"),
}
_remove_replaced_routes(payments.router, _PAYMENT_HISTORY_ROUTES | _PAYMENT_CHECKOUT_ROUTES)
api_router.include_router(payment_history.router)
api_router.include_router(payment_checkout_integrity.router)
api_router.include_router(payments.router)
api_router.include_router(estimate.router)
api_router.include_router(change_orders.router)

_BANK_STATEMENT_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/import/bank-statement", "POST"),
    ("/projects/{project_id}/import/bank-statement/confirm", "POST"),
}
_remove_replaced_routes(export.router, _BANK_STATEMENT_ROUTES)
api_router.include_router(bank_statements.router)
api_router.include_router(export.router)
api_router.include_router(receipts.router)
api_router.include_router(purchases.router)

# --- misc ---
api_router.include_router(scratchpad.router)
