# P3-W38 — Ops alert · Ollama digest · bank import UX

## Сделано

| Task | Изменение |
|------|-----------|
| P4.2a Ops email | `ops_alert_email` → email при 3+ consecutive automation fails |
| P4.2c Ollama | `ollama_digest_enabled` + `ollama_base_url` — narrative fail-open |
| Bank UX | Document Center Modal (native+web) для paste CSV |
| Tests | `legacyRoutes` catch-all; `test_ollama_digest` |

## Env

```bash
OPS_ALERT_EMAIL=ops@example.com
OLLAMA_DIGEST_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3
```

## DoD
- Worker fail streak ≥3 → log ALERT + optional email once per streak
- Digest без Ollama = rule body; с Ollama = `ai_narrative: true`
- Импорт выписки открывает Modal на iOS/Android/web

## Не в этом PR
- SMTP real transport
- route files <50 (ещё deep-link thin redirects)
- YuKassa staging keys (ops)
