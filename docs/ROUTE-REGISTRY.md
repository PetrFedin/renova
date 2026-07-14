# Renova — Route Registry (A-04 / A-07)

**Дата:** 2026-07-15  
**Код:** `apps/mobile/lib/routeRegistry.ts`

## Правила

1. **Dock ≤ 4:** Главная · Объект · Ремонт · Бюджет  
2. **Secondary centers** → `visibility: 'more'` (Управление проектом)  
3. **WIP** (`status: 'wip'`) не показывается в меню  
4. Каждый visible route имеет ≥1 `entryPoints`

## Secondary centers (beta/ga)

| id | path | status |
|----|------|--------|
| manager-dashboard | `/manager-dashboard` | beta |
| finance-center | `/finance-center` | beta |
| quality-control | `/quality-control` | beta |
| work-acceptance | `/work-acceptance` | ga |
| work-schedule | `/work-schedule` | beta |
| documents | `/documents` | beta |
| notifications | `/notifications` | beta |

## Tests

```bash
node apps/mobile/lib/__tests__/routeRegistry.test.mjs
```

## UI wiring

`HomeScreenBody` → блок «Дополнительно» строится из `menuRoutes(role, 'more')`.
