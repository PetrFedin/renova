# Audit wave-8 — Phase E embed + mobile syntax fix (2026-07-21)

## Hotfix

Сломанные import (SyntaxError «Unexpected token»):

- `MaterialPickList.tsx` — пропал `import {` перед `procurementNav`
- `UnifiedScheduleView.tsx` — то же для `scheduleCloseoutNav`

## Phase E (P2)

| ID | Что | Зачем |
|----|-----|--------|
| E1 | Lead `address_precision` / `location_public` | Улица скрыта до assign |
| E2 | `job_lead_quotes` + `POST …/quotes/{id}/accept` | Не first-wins; заказчик выбирает КП |
| E3 | `POST /auth/ws-ticket` + mobile `buildWsAuthQuery` | JWT не в query URL |
| E4 | `DELETE /me` → soft-delete + revoke sessions | Нет hard wipe проектов |

## Мобильный UX

`JobLeadsBoard`: кнопки «Принять · ₽» по quotes; адрес показывает `address || location_public`.

## Тесты

```bash
cd backend && .venv/bin/pytest tests/test_lead_address_privacy.py tests/test_ws_ticket.py tests/test_soft_delete_fields.py -q --noconftest
```
