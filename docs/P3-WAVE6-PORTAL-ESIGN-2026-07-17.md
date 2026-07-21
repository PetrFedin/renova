# P3-WAVE6 — Portal eSign + offline docs (2026-07-17)

## Закрыто

| ID | Задача |
|----|--------|
| P3.2a | Portal sign draft docs — scope `sign_document`, POST `/portal/.../documents/{id}/sign` |
| P3.2d | CO approve → activity `DocumentDraftForSign` + draft contract |
| P3.3d | Offline queue: `signProjectDocument` metadata |
| P3.1a | Staging checklist: YuKassa keys required, no demo pay |

## Тесты

`pytest tests/test_portal_sign.py tests/test_portal_accept.py -q`

## Следующий (P3-W7)

1. Kontur live webhook production
2. Portal Kontur redirect from browser
3. Offline document upload queue UI
4. Registry v3 — delete legacy tab files
5. Contract gate: estimate → eSign → work unlock
