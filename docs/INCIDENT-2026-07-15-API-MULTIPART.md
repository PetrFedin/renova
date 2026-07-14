# Incident: API не стартовал после Document Wave 2

**Дата:** 2026-07-15  
**Симптом:** `npm run dev` / preview «не грузится» — Expo на :8081 жив, API :8100 в crash-loop.  
**Ошибка:**

```
RuntimeError: Form data requires "python-multipart" to be installed.
  File ".../documents.py", line @router.post("/{project_id}/documents/upload")
```

## Root cause

Wave 2 добавил multipart upload endpoint и зависимость в `pyproject.toml`, но **`.venv` на машине не был обновлён** (`pip/poetry install` не прогнан после pull). Uvicorn reload импортировал `documents.py` → FastAPI валидировал Form/File → fail → backend мёртв → mobile UI без данных.

## Fix applied

1. `pip install python-multipart aiosqlite` в `backend/.venv`
2. `python-multipart` / `aiosqlite` зафиксированы в `backend/pyproject.toml`
3. `scripts/start-dev.sh` — авто-проверка `import multipart` перед uvicorn
4. Документ этого инцидента в git

## Verify

```bash
curl -s http://127.0.0.1:8100/health
# {"status":"ok",...,"environment":"development"}
open http://127.0.0.1:8081/iphone-preview.html
```

## Prevention

После `git pull` на develop:

```bash
cd backend && source .venv/bin/activate && pip install -e . 
# или: poetry install
```

Или просто `npm run dev` (start-dev теперь ставит multipart при отсутствии).

## Related follow-up (same session)

After multipart fix, GET document media returned **500 RecursionError** in `storage_service.presigned_url` ↔ CloudFront helpers.
Fixed in same push as Wave 3 media nested routes.
