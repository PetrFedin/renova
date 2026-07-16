# P0 Wave — Acceptance unify + golden path fixes (2026-07-16)

**Branch:** `develop`  
**Plan:** `docs/PRODUCT-REMEDIATION-PLAN-2026-07-15.md` (P0.1–P0.4)

## P0.1 Единый канон приёмки

### Backend
| Endpoint | Действие |
|----------|----------|
| `POST /projects/{id}/stages/{stage_id}/accept` | **410** + header `X-Deprecated-Use: work-acceptances` |
| `POST /os/projects/{id}/acceptances/{id}/accept\|return` | Proxy → `work_acceptances.py` |
| `GET /projects/{id}/work-acceptances/pending-count` | Canonical pending count |

### Mobile
- Все list/submit/accept/return → `workAcceptancesApi` (`/work-acceptances`)
- Legacy методы удалены из `workOrdersApi`
- Control tab: `listWorkAcceptances`
- `HomeAcceptanceBanner` → `/work-acceptance`
- Offline queue для request/accept/return

### Tests
- `backend/tests/test_acceptance_canon.py` — `test_legacy_accept_returns_410`, canon accept, OS proxy
- `test_e2e_flow.py` — golden path через work-acceptances

## P0.2 Finance Center → PaymentDetailSheet

- `FinanceCenterScreen`: tap pending → `PaymentDetailSheet` (gate приёмки как в Budget)
- `routeRegistry`: `finance-center` → `opensSheet: 'payment'`, `redirectTo: '/budget?tab=payments'`

## P0.3 Cross-domain notify

| Действие | notify | activity |
|----------|--------|----------|
| CO create/approve/reject | `change_order` | ✅ |
| Payment confirm | обе стороны | ✅ |
| Document sign/archive | `document` | ✅ |

Tests: `backend/tests/test_cross_domain_notify.py` (row created + `approval-digest` includes CO)

## P0.4 Mobile dead ends batch 1

| ID | Fix |
|----|-----|
| M5 | Kontur CTA скрыт если `!kontur.available` |
| M6 | Doc без файла → Alert с CTA «Загрузить» |
| M7 | `DesignPackageList` → `pickDocumentForUpload` (native + web) |
| M10 | `resolveNotificationLink` + `NotificationsScreen` fallback |
| M13 | `ContractorControlView` → `role="contractor"` в `UnifiedAcceptanceList` |

## Verification

```bash
cd backend && poetry run pytest -q
npm run test:priority
bash scripts/e2e-smoke.sh
```

## Definition of Done (P0.1–P0.4)

- [x] Один API приёмки (`work-acceptances`)
- [x] Один вход оплат с gate (`PaymentDetailSheet`)
- [x] CO/payment/document → notify + activity
- [x] Dead ends M5,M6,M7,M10,M13 закрыты
- [x] pytest + `test:priority` PASS
