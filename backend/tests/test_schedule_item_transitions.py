"""Schedule item transition matrix."""
from app.models.work_schedule import WorkScheduleItemStatus
from app.services.schedule_item_transitions import _TRANSITIONS


def test_accepted_only_from_submitted_customer():
    assert _TRANSITIONS[(WorkScheduleItemStatus.submitted, WorkScheduleItemStatus.accepted)] == "customer"


def test_illegal_submitted_to_in_progress():
    assert (WorkScheduleItemStatus.submitted, WorkScheduleItemStatus.in_progress) not in _TRANSITIONS


def test_no_transitions_from_accepted():
    assert not [a for (a, _b) in _TRANSITIONS if a == WorkScheduleItemStatus.accepted]
