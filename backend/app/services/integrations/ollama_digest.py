"""Optional Ollama narrative for weekly digest (P4.2c+). Fail-open → None."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def _facts_prompt(project_name: str, weekly: dict[str, Any]) -> str:
    budget = weekly.get("budget") or {}
    planned = budget.get("budget_planned") or budget.get("planned")
    spent = budget.get("budget_spent") or budget.get("spent")
    return (
        f"Проект ремонта «{project_name}». Сформируй краткий дайджест на русском "
        f"(3–5 предложений, без markdown): прогресс {weekly.get('progress_percent')}%, "
        f"этапы {weekly.get('stages_done')}/{weekly.get('stages_total')}, "
        f"бюджет план {planned} факт {spent}, "
        f"просрочки: {', '.join(weekly.get('overdue_works') or []) or 'нет'}, "
        f"открытых замечаний: {weekly.get('open_issues_count')}, "
        f"события: {'; '.join((weekly.get('highlights') or [])[:5]) or 'нет'}."
    )


async def generate_digest_narrative(project_name: str, weekly: dict[str, Any]) -> str | None:
    if not settings.ollama_digest_enabled:
        return None
    base = (settings.ollama_base_url or "").rstrip("/")
    if not base:
        return None
    model = settings.ollama_model or "qwen3"
    prompt = _facts_prompt(project_name, weekly)
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                f"{base}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            if r.status_code >= 400:
                logger.warning("ollama digest http %s", r.status_code)
                return None
            data = r.json()
            text = (data.get("response") or "").strip()
            return text[:1200] if text else None
    except Exception as exc:
        logger.warning("ollama digest skipped: %s", exc)
        return None
