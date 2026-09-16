"""Static contract for the deterministic review/development showcase fixture."""
from pathlib import Path


def test_showcase_covers_all_primary_hubs_and_midlife_states():
    root = Path(__file__).resolve().parents[2]
    text = (root / "backend" / "app" / "services" / "seed_showcase.py").read_text(encoding="utf-8")

    # Object: dense estimate + visual plan.
    assert "40 - len(lines)" in text
    assert "Демо-план квартиры" in text
    assert "FloorPlanPin" in text

    # Repair: eight stages, selections, schedule delay/block and acceptance-compatible review state.
    assert "stages[:8]" in text
    assert "SelectionStatus.proposed" in text
    assert "WorkScheduleItemStatus.delayed" in text
    assert "WorkScheduleItemStatus.blocked" in text
    assert "StageStatus.review" in text

    # Money: expense history + fifteen payments + verified/mismatch/no-receipt/disputed states.
    assert "for idx in range(15)" in text
    assert 'PaymentStatus.paid_unverified' in text
    assert 'PaymentStatus.disputed' in text
    assert 'verification_status="demo_verified"' in text
    assert 'saved_unverified' in text
    assert "Expense(" in text

    # Cross-cutting product contours.
    assert "ChangeOrderStatus.pending" in text
    assert "create_or_replay_warranty_claim" in text
    assert "JobLeadQuote" in text
    assert "NotificationType.deadline" in text
