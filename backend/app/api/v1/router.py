from fastapi import APIRouter
from app.api.v1 import portal
from app.api.v1 import portal_change_order_decisions
from app.api.v1 import account_lifecycle
from app.api.v1 import document_lifecycle
from app.api.v1 import selections
from app.api.v1 import bank_statements
from app.api.v1 import expense_mutations
from app.api.v1 import material_price_sync
from app.api.v1 import payment_disputes
from app.api.v1 import payment_history
from app.api.v1 import project_creation
from app.api.v1 import stage_review_transitions
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
    """Remove legacy handlers that would otherwise shadow canonical routes.

    FastAPI resolves duplicate routes by registration order while still exposing both
    handlers at runtime. Keeping only one exact path+method pair makes execution,
    OpenAPI generation and tests deterministic.
    """

    def is_replaced(route) -> bool:
        path = getattr(route, "path", None)
        methods = set(getattr(route, "methods", set()) or set())
        return any(path == target_path and method in methods for target_path, method in signatures)

    router.routes[:] = [route for route in router.routes if not is_replaced(route)]


# --- content / design ---
api_router.include_router(design_packages.router)
api_router.include_router(marketplace.router)

# Canonical price refresh is public-network only and never fabricates a fallback.
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
api_router.include_router(project_work_schedule.router)
api_router.include_router(stages_ext.router)
api_router.include_router(project_checklists.router)
api_router.include_router(checklist_templates.router)
api_router.include_router(stage_reactions.router)

# Document state and required side effects must share one transaction.
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

# Canonical direct expense writes replace legacy OS handlers with the same paths.
_EXPENSE_MUTATION_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/os/expenses/{expense_id}", "PATCH"),
    ("/projects/{project_id}/os/expenses/{expense_id}", "DELETE"),
}
_remove_replaced_routes(os.router, _EXPENSE_MUTATION_ROUTES)
api_router.include_router(expense_mutations.router)
api_router.include_router(os.router)

# Replace the two legacy portal CO routes at runtime while the portal module is decomposed.
_PORTAL_CHANGE_ORDER_ROUTES: set[RouteSignature] = {
    ("/portal/projects/{project_id}/change-orders/{order_id}/approve", "POST"),
    ("/portal/projects/{project_id}/change-orders/{order_id}/reject", "POST"),
}
_remove_replaced_routes(portal.router, _PORTAL_CHANGE_ORDER_ROUTES)
api_router.include_router(portal_change_order_decisions.router)
api_router.include_router(portal.router)
api_router.include_router(reports.router)

# --- core / identity ---
# Account lifecycle endpoints are security-sensitive and replace legacy handlers
# by exact path+method while preserving GET /auth/me.
_ACCOUNT_LIFECYCLE_ROUTES: set[RouteSignature] = {
    ("/auth/anonymize", "POST"),
    ("/auth/me", "DELETE"),
    ("/auth/sessions/revoke-all", "POST"),
    ("/auth/admin/purge-deleted-accounts", "POST"),
}
_remove_replaced_routes(auth.router, _ACCOUNT_LIFECYCLE_ROUTES)
api_router.include_router(account_lifecycle.router)
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

# Project creation and stage review transitions are atomic canonical handlers.
_PROJECT_CREATION_ROUTES: set[RouteSignature] = {
    ("/projects", "POST"),
    ("/projects/from-template", "POST"),
}
_STAGE_REVIEW_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/stages/{stage_id}/submit", "POST"),
    ("/projects/{project_id}/stages/{stage_id}/reject", "POST"),
}
_remove_replaced_routes(projects.router, _PROJECT_CREATION_ROUTES | _STAGE_REVIEW_ROUTES)
api_router.include_router(project_creation.router)
api_router.include_router(stage_review_transitions.router)
api_router.include_router(projects.router)
api_router.include_router(rooms.router)
api_router.include_router(room_requests.router)
api_router.include_router(calendar.router)
api_router.include_router(chat_inbox.router)
api_router.include_router(chats.router)

# --- finance ---
# Canonical customer dispute transition must precede general payment routes.
api_router.include_router(payment_disputes.router)

# Canonical list projection adds evidence history and removes receipt/event N+1 queries.
_PAYMENT_HISTORY_ROUTES: set[RouteSignature] = {
    ("/projects/{project_id}/payments", "GET"),
}
_remove_replaced_routes(payments.router, _PAYMENT_HISTORY_ROUTES)
api_router.include_router(payment_history.router)
api_router.include_router(payments.router)
api_router.include_router(estimate.router)
api_router.include_router(change_orders.router)

# Canonical bank statement writes replace legacy export handlers with the same paths.
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
