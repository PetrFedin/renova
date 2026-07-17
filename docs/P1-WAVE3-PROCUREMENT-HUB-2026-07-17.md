# P1 Wave 3 — Procurement hub UI (2026-07-17)

## P1.7 Materials subtabs

`OsMaterialsScreen` — три вкладки внутри «Ремонт → Материалы»:

| Subtab | Содержимое |
|--------|------------|
| **Потребности** | MaterialPickList + фильтры + «Из сметы» / «Создать закупку» |
| **Закупки** | PurchaseList + advance status |
| **Чеки** | MaterialReceiptReconcile + hint scan-receipt |

### Deep links

- `/(role)/(tabs)/repair?tab=materials&subtab=purchases`
- Registry: `materials-procurement` → purchases subtab

### Badges

- Потребности: count «купить»
- Закупки: open purchases
- Чеки: unverified receipts

## Verify

```bash
npm run mobile:test
npm run test:priority
```

## Next

- Staging URL в `eas.json` (реальный HTTPS перед TestFlight)
- E2E procurement chain
