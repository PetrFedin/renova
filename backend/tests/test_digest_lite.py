"""W51: rule-based weekly digest always works without Ollama."""
from app.services.digest_lite_service import build_rule_based_digest, digest_mode


def test_rule_based_digest_ru():
    text = build_rule_based_digest(
        "Квартира демо",
        {
            "progress_percent": 40,
            "stages_done": 2,
            "stages_total": 5,
            "budget": {"budget_planned": 1000000, "budget_spent": 250000},
            "overdue_works": ["Электрика"],
            "open_issues_count": 1,
            "critical_issues": 0,
            "highlights": ["Приёмка этапа", "Оплата"],
        },
    )
    assert "Квартира демо" in text
    assert "40%" in text
    assert "Электрика" in text
    assert "KPI PDF" in text or "Отчёты" in text


def test_digest_mode_default_rule(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "ollama_digest_enabled", False)
    monkeypatch.setattr(config.settings, "ollama_base_url", None)
    assert digest_mode() == "rule"
