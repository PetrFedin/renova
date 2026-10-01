from app.services.risk_engine import forecast_overrun


def test_no_forecast_without_spend_or_progress() -> None:
    # Регресс: planned=137788, spent=0, progress=0 давал +13 641 042 ₽ к смете.
    assert forecast_overrun(137788.3, 0, 0) == 0
    assert forecast_overrun(137788.3, 0, 40) == 0
    assert forecast_overrun(137788.3, 5000, 2) == 0


def test_forecast_extrapolates_by_pace() -> None:
    # 60 000 потрачено при 50 % — выйдем на 120 000 при плане 100 000.
    assert round(forecast_overrun(100_000, 60_000, 50)) == 20_000
    assert forecast_overrun(100_000, 40_000, 50) < 0
    assert forecast_overrun(100_000, 90_000, 100) < 0
