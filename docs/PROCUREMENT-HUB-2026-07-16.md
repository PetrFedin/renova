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

## Mobile (текущее)

| UI | Путь | Заметка |
|----|------|---------|
| Materials tab | `repair?tab=materials` | OsMaterialsHub / picks list |
| Scan receipt | `/scan-receipt` | deeplink из budget/repair |
| Deep link registry | `materials-procurement` → `/repair?tab=materials` | `routeRegistry.ts` |

## Следующая волна (не P1.7)

- Subtabs: Picks · Purchases · Receipts в одном hub
- E2E: pick approved → purchase → receipt link → budget alert

## Side effects

- `MaterialDelivered` → automation_engine notify contractor
- Receipt confirm → `ExpenseAdded` / budget refresh
