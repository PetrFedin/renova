# P3 Wave 2 — Project Lifecycle & IA Quick Wins

**Дата:** 2026-07-17  
**Ветка:** `develop`  
**Связь:** `docs/RENOVA-COMPETITIVE-GAP-PLAN-2026-07-17.md` (P3.1c, P3.2, P3.4)

## Сделано в этой волне

### 1. Project archive / trash (lifecycle)

| Слой | Изменения |
|------|-----------|
| **Backend** | `Project.is_archived`, `Project.trashed_at`; lifecycle в `project_service`; `GET /projects?bucket=active\|archived\|trashed`; trashed блокируется в `require_project` |
| **Mobile** | `ProjectBucketToolbar`, `useProjectBuckets`, `useProjectLifecycleActions`; toolbar + card actions в pickers; pick только active; trash active → `clearActiveProject()` |
| **Migration** | `t4u5v6w7x8y9_project_lifecycle.py` + `sqlite_compat` |

### 2. Punch → QC (P3.2)

`FloorPlanPanel`: после create issue → `/quality-control` + Alert.

### 3. Schedule redirect (P3.4)

`/work-schedule` → calendar tab; `routeRegistry.redirectTo`; `WorkScheduleSummaryCard` / `pushLinks`.

### 4. Finance-center

Redirect на budget › payments — verified в routeRegistry + pushLinks.

### 5. SBP clipboard (P3.1c)

`PaymentDetailSheet`: «Скопировать сумму» (`expo-clipboard`) + hint открыть банк.

## Что дальше

- Portal v2 (sign/pay)
- YuKassa staging E2E
- Kontur webhook
- Registry v3 / legacy tab cleanup
