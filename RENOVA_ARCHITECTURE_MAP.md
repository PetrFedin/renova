# Renova architecture map

User → role/capabilities → project → object/rooms → stages → work orders/materials → QC/acceptance → budget/expenses/payments → documents → chat → Inbox attention.

Navigation is resolved through `navigationPolicy`, role-aware tab builders, and `pushOsNav`. Construction context is normalized by `constructionLocation` and `constructionProjectGraph`; stage screens consume the graph through `StageContextSummary`.

## Canonical hubs

- Object: rooms, plan, design, estimate
- Repair: stages, works, materials, control
- Budget: payments, expenses, deviations
- Calendar: schedule and deadlines
- Chat: project communication
- Inbox: tasks and notifications
- Documents: project files and warranty claims
