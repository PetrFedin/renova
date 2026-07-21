# Procurement Hub — scaffold (P1.7)

**Цель:** RU parity цепочка материалов без полного UI в этой волне.

## Golden chain

```text
MaterialPick (approved) → Purchase → Receipt scan → plan-fact update
```

## Backend

| Шаг | API | Файл |
|-----|-----|------|
| Picks | `GET/POST .../material-picks` | `backend/app/api/v1/materials.py` |
| Purchases | `GET/POST .../purchases` | `backend/app/api/v1/purchases.py` |
| Receipts | `GET/POST .../receipts`, OCR | `backend/app/api/v1/receipts.py` |
| Plan-fact | analytics expenses | `backend/app/api/v1/analytics.py` |

## Mobile (P1.7)

| UI | Путь | Заметка |
|----|------|---------|
| Materials hub | `repair?tab=materials&subtab=picks\|purchases\|receipts` | OsMaterialsScreen + OsHubTabs |
| Scan receipt | `/scan-receipt` | deeplink из budget/repair |
| Deep link | `materials-procurement` → `repair?tab=materials&subtab=purchases` | `routeRegistry.ts` |

## Следующая волна

- E2E: pick approved → purchase → receipt link → budget alert
- Receipt list per purchase (не только сверка по комнатам)

## Side effects

- `MaterialDelivered` → automation_engine notify contractor
- Receipt confirm → `ExpenseAdded` / budget refresh
