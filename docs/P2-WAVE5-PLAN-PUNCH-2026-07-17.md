# P2 Wave 5 — Plan-pinned punch (2026-07-17)

## P2.3 Punch list на плане

### Модель (`project_issues`)
| Поле | Назначение |
|------|------------|
| `floor_plan_id` | FK → `floor_plans` |
| `x_pct`, `y_pct` | координаты на чертеже (0–100%) |
| `photo_key` | опциональное фото дефекта |

### API
- `POST /api/v1/projects/{id}/issues` — body дополнен: `floor_plan_id`, `x_pct`, `y_pct`, `photo_key`
- `GET /api/v1/projects/{id}/floor-plans` — в каждом плане массив `punch[]`

### Mobile
- `FloorPlanPanel` — режим **Punch list**, tap на план → `createIssue` с координатами
- Маркеры `!` на плане (цвет по severity/status)
- `QualityControlScreen` — метка «на плане»

### Migration
`s3t4u5v6w7x8_issue_plan_pins.py`

## Verify
```bash
cd backend && .venv/bin/python -m pytest tests/test_plan_punch.py -q
cd backend && .venv/bin/python -m pytest -q
npm run test:priority
```

## Next
- Фото при tap (ImagePicker → `photo_key`)
- Приёмка с pin на плане (`work-acceptances` + x,y)
- Staging URL в `eas.json` (когда задан реальный хост)
