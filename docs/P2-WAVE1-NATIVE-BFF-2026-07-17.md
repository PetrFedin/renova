# P2 Wave 1 — Native file parity + Budget BFF (2026-07-17)

## P2.4 Native file parity

| Файл | Изменение |
|------|-----------|
| `lib/downloadFile.ts` | native: FileSystem + Sharing; PDF → share sheet |
| `lib/mediaUpload.ts` | `readIcalFile()` — DocumentPicker на iOS/Android |
| `IcalImportButton.tsx` | импорт .ics на native |
| `ScheduleIconToolbar.tsx` | импорт .ics на native |

## P2.5 Budget BFF

- `GET /api/v1/projects/{id}/budget-summary?threshold_pct=5`
- `budget_service.budget_hub()` — summary, expenses, payments, receipts, picks, alerts
- Mobile: `api.budgetSummaryHub()` → `useOsBudgetScreen` (fallback на legacy 6 calls)

## Kontur polling (P1.2 доп.)

- `lib/esignPoll.ts` — poll signature status после sign
- `DocumentsHub` — короткий poll после «Подписать через Контур»

## Verify

```bash
cd backend && .venv/bin/python -m pytest tests/test_budget_summary_hub.py -q
npm run test:priority
```

## Next

- Real staging URL в EAS secrets
- P2.1 web portal / P2.2 selections
