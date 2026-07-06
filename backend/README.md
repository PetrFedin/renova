# Renova Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn httpx pydantic pydantic-settings
uvicorn app.main:app --reload --port 8100
```

API docs: http://localhost:8100/docs

## Бюджет и факт

- Server ledger: `app/services/budget_service.py` (`refresh_budget_facts`, `budget_summary`)
- Контракт с mobile UI: `../docs/BUDGET_FACT.md`
