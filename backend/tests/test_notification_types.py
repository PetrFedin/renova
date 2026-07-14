"""CI regression: accept flow uses stage_started; aliases must not crash notify."""
from app.models.entities import NotificationType
from app.services.notification_service import resolve_notification_type


def test_stage_started_is_canonical():
    assert resolve_notification_type("stage_started") is NotificationType.stage_started


def test_stage_start_alias():
    assert resolve_notification_type("stage_start") is NotificationType.stage_started


def test_material_alias():
    assert resolve_notification_type("material") is NotificationType.materials


def test_budget_alias():
    assert resolve_notification_type("budget") is NotificationType.budget_alert


def test_unknown_falls_back_to_other():
    assert resolve_notification_type("not_a_real_type_xyz") is NotificationType.other


def test_known_extra_types():
    for name in (
        "approval",
        "issue",
        "deadline",
        "waste_reminder",
        "room_created",
        "document",
    ):
        assert resolve_notification_type(name) is NotificationType(name)
