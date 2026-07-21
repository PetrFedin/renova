"""Unit: local_today + counter shape helpers (без БД)."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.services.task_counters_service import local_today


def test_local_today_uses_timezone_not_server_utc():
    moscow = local_today("Europe/Moscow")
    tokyo = local_today("Asia/Tokyo")
    assert isinstance(moscow, date)
    assert isinstance(tokyo, date)
    assert moscow == datetime.now(ZoneInfo("Europe/Moscow")).date()
    assert tokyo == datetime.now(ZoneInfo("Asia/Tokyo")).date()


def test_local_today_invalid_timezone_falls_back_utc():
    d = local_today("Not/A_Real_Zone")
    assert d == datetime.now(ZoneInfo("UTC")).date()
