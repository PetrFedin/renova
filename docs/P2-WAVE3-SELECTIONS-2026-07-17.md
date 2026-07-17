# P2 Wave 3 — Selections tracker (2026-07-17)

## P2.2 Подбор чистовых материалов

### Модель
`selection_items`: room × category × title/sku × allowance × price × status

| Status | Значение |
|--------|----------|
| draft | черновик исполнителя |
| proposed | на согласовании заказчика |
| approved | согласовано |
| rejected | отклонено |

Categories: tile, plumbing, lighting, doors, kitchen, paint, other

### API
- `GET/POST /api/v1/projects/{id}/selections`
- `GET .../selections/pending-count`
- `POST .../selections/{id}/propose|approve|reject`

### Mobile
- Repair hub → вкладка **«Подбор»** (`?tab=selections`)
- `OsSelectionsScreen` — фильтры, propose/approve/reject
- Badge на вкладке для pending count

### Migration
`r2s3t4u5v6w7_selection_items.py`

## Verify
```bash
cd backend && .venv/bin/python -m pytest tests/test_selections.py -q
npm run test:priority
```

## Next
- Link approved selection → MaterialPick
- Portal: selections read-only for viewers
