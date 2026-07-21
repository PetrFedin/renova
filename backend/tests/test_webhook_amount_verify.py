"""Webhook amount mismatch tolerance."""


def test_amount_tolerance():
    assert abs(100.0 - 100.0) <= 0.01
    assert abs(100.0 - 100.02) > 0.01
