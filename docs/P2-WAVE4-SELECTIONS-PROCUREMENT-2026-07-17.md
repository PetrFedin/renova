# P2 Wave 4 — Selection → MaterialPick + Portal (2026-07-17)

## Selection approve → procurement

При `POST .../selections/{id}/approve`:
- `selection_service.material_pick_from_selection()` создаёт `MaterialPick` со status `approved`
- Activity + redirect hint → `repair?tab=materials&subtab=picks`
- Response включает `material_pick_id`

## Portal snapshot

`GET /portal/projects/{id}/snapshot` дополнен:
- `selections` (до 15)
- `selections_total`

## Mobile

- `OsSelectionsScreen` — alert после approve
- `portal.tsx` — блок «Подбор материалов»

## Verify
```bash
cd backend && .venv/bin/python -m pytest tests/test_selections.py -q
npm run test:priority
```
