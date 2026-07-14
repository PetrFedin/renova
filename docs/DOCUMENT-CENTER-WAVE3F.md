# Document Center — Wave 3f (Kontur/Goskey scaffold + release prep)

**Дата:** 2026-07-15  
**Ветка:** `develop`  
**Репозиторий:** https://github.com/PetrFedin/renova

## Зачем

Нужен **контракт** внешних УКЭП без слома текущего e2e (по умолчанию kontur/goskey всё ещё 501).  
Sandbox-режим позволяет руками прогнать pending → webhook → signed до реальной аккредитации.

## Env

| Variable | Default | Смысл |
|----------|---------|--------|
| `KONTUR_MODE` | `off` | `off` \| `sandbox` \| `live` |
| `KONTUR_API_KEY` | — | нужен для available |
| `KONTUR_API_URL` | placeholder | для live scaffold |
| `GOSKEY_MODE` | `off` | `off` \| `sandbox` \| `live` |
| `GOSKEY_CLIENT_ID` | — | нужен для available |
| `ESIGN_WEBHOOK_SECRET` | — | если задан — обязателен header `X-Esign-Secret` |

## Providers

- `backend/app/services/esign/kontur.py`
- `backend/app/services/esign/goskey.py`
- Registry читает `settings` → `available` динамически

### Поведение sign

| Состояние | Result | API |
|-----------|--------|-----|
| mode=off / no key | unavailable | **501** (как Wave 3b) |
| sandbox + key | `status=pending`, `provider_external_id` | **200** |
| webhook `POST /api/v1/esign/webhooks/kontur` | pending → signed | **200** |

`document_signatures.signed_at` стал **nullable** (миграция `p6q7r8s9t0u1`).

## Mobile

DocumentsHub: пункт «Подписать через Контур» — если провайдер unavailable, объясняет про env; иначе создаёт pending.

## Release prep

См. `docs/RELEASE-v0.2-PREP.md` и `scripts/release-notes-v0.2.sh`.

## Acceptance

1. Default: kontur sign → 501 (e2e)
2. `KONTUR_MODE=sandbox` + key → pending + webhook → signed (unit)
3. `npm run test:priority` green

## Не делаем

- Auto-merge PR #2
- Реальный HTTP Контур SDK
