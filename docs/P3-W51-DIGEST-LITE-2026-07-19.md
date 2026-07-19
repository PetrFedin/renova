# P3-W51 — Weekly digest lite (2026-07-19)

## Зачем (P2.5)

Retention и демо инвестору: **еженедельный RU-дайджест** без зависимости от Ollama.  
LLM — опция (`OLLAMA_DIGEST_ENABLED`), fail-open → rule-based.

## Сделано

| Компонент | Изменение |
|-----------|-----------|
| `digest_lite_service` | `build_rule_based_digest` + `compose_weekly_digest` |
| `GET …/digest/weekly/preview` | Превью без push |
| `POST …/digest/weekly` | Push + архив в Document Center + honesty `source`/`mode` |
| DocumentsHub / Отчёты | Alert с режимом + KPI PDF / превью |
| Тесты | `test_digest_lite.py`, `test_digest_weekly_api.py` |

## Env (опционально)

```
OLLAMA_DIGEST_ENABLED=1
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3
```

## Проверка

```bash
cd backend && PYTHONPATH=. .venv/bin/pytest -q tests/test_digest_lite.py tests/test_digest_weekly_api.py
```
