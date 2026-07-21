"""P2.5 / W51: weekly digest lite — rule-based RU summary + optional Ollama (fail-open)."""
from __future__ import annotations

from app.core.timeutil import utc_now
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.integrations.ollama_digest import generate_digest_narrative


def build_rule_based_digest(project_name: str, weekly: dict[str, Any]) -> str:
    """Всегда доступный текст без LLM — основа доверия на демо."""
    budget = weekly.get("budget") or {}
    planned = budget.get("budget_planned") or budget.get("planned") or 0
    spent = budget.get("budget_spent") or budget.get("spent") or 0
    try:
        planned_f = float(planned)
        spent_f = float(spent)
    except (TypeError, ValueError):
        planned_f, spent_f = 0.0, 0.0
    progress = weekly.get("progress_percent")
    done = weekly.get("stages_done") or 0
    total = weekly.get("stages_total") or 0
    overdue = weekly.get("overdue_works") or []
    issues = weekly.get("open_issues_count") or 0
    critical = weekly.get("critical_issues") or 0
    highlights = [h for h in (weekly.get("highlights") or []) if h][:4]

    lines = [
        f'Неделя по объекту «{project_name}».',
        f'Прогресс {progress}% ({done}/{total} этапов).',
        f'Бюджет: план {planned_f:,.0f} ₽ · факт {spent_f:,.0f} ₽.'.replace(",", " "),
    ]
    if overdue:
        lines.append("Просрочки: " + ", ".join(overdue[:3]) + ".")
    else:
        lines.append("Просроченных этапов нет.")
    if issues:
        crit = f", из них критичных {critical}" if critical else ""
        lines.append(f"Открытых замечаний: {issues}{crit}.")
    else:
        lines.append("Открытых замечаний нет.")
    w_open = weekly.get("warranty_open") or 0
    w_over = weekly.get("warranty_overdue") or 0
    if w_open:
        over = f", просрочено {w_over}" if w_over else ""
        lines.append(f"Гарантийных обращений: {w_open}{over}.")
    pend_acc = weekly.get("pending_acceptances") or 0
    if pend_acc:
        lines.append(f"Ждут приёмки: {pend_acc}.")
    if highlights:
        lines.append("События: " + "; ".join(highlights) + ".")
    lines.append("Подробности — KPI PDF и раздел «Отчёты».")
    return " ".join(lines)


def digest_mode() -> str:
    """Honesty: rule | ollama_optional."""
    if settings.ollama_digest_enabled and settings.ollama_base_url:
        return "ollama_optional"
    return "rule"


async def compose_weekly_digest(
    db: AsyncSession,
    *,
    project_name: str,
    weekly: dict[str, Any],
) -> dict[str, Any]:
    """Rule-based всегда; Ollama дополняет при успехе."""
    _ = db
    rule = build_rule_based_digest(project_name, weekly or {})
    narrative = await generate_digest_narrative(project_name, weekly or {})
    mode = digest_mode()
    if narrative:
        body = narrative.strip()
        source = "ollama"
    else:
        body = rule
        source = "rule"
    return {
        "title": f"Недельный дайджест: {project_name}",
        "body": body,
        "push_body": body[:280],
        "rule_body": rule,
        "source": source,
        "mode": mode,
        "generated_at": utc_now().isoformat() + "Z",
        "weekly": {
            "progress_percent": (weekly or {}).get("progress_percent"),
            "stages_done": (weekly or {}).get("stages_done"),
            "stages_total": (weekly or {}).get("stages_total"),
            "open_issues_count": (weekly or {}).get("open_issues_count"),
            "warranty_open": (weekly or {}).get("warranty_open"),
            "warranty_overdue": (weekly or {}).get("warranty_overdue"),
            "pending_acceptances": (weekly or {}).get("pending_acceptances"),
        },
    }
