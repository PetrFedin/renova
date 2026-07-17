# P2 Wave 2 — Web client portal (2026-07-17)

## P2.1 Magic link + read-only snapshot

### Backend
- `portal_token_service.py` — HMAC-signed token (7d TTL)
- `POST /api/v1/projects/{id}/viewers/{viewer_id}/portal-link` — заказчик
- `POST /api/v1/auth/portal/session` — обмен token → user_id + project
- `GET /api/v1/portal/projects/{id}/snapshot` — schedule, pending payments, documents

### Mobile / Expo web
- `ViewerSharePanel` — кнопка 🔗 Share magic link
- `app/portal.tsx` — read-only UI по `?token=`
- `routeRegistry` — id `portal`

### Flow
1. Заказчик добавляет гостя (viewer)
2. Нажимает 🔗 → Share URL `…/portal?token=…`
3. Гость открывает в браузере → snapshot read-only

## Verify
```bash
cd backend && .venv/bin/python -m pytest tests/test_portal_token.py -q
npm run test:priority
```

## Next
- Branded theme + accept/sign actions in portal
- P2.2 Selections tracker
