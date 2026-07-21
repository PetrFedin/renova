"""YuKassa health probe flags."""
from app.services.yookassa_service import yookassa_health


def test_yookassa_health_shape(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "yookassa_shop_id", None)
    monkeypatch.setattr(config.settings, "yookassa_secret", None)
    monkeypatch.setattr(config.settings, "environment", "staging")
    h = yookassa_health()
    assert h["configured"] is False
    assert h["demo_allowed"] is False
    assert "webhook" in h["webhook_url"]
    assert h["hint"]


def test_collect_warnings_yookassa_staging():
    from app.core.environment import collect_warnings
    w = collect_warnings(
        environment="staging",
        database_url="postgresql+asyncpg://x",
        secret_key="not-default-secret-key-32chars!!",
        yookassa_shop_id=None,
        yookassa_secret=None,
    )
    assert any("YOOKASSA" in x for x in w)
