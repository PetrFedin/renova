"""E5 schedule_version on model."""
from app.models.work_schedule import ProjectWorkSchedule


def test_schedule_has_version_columns():
    assert hasattr(ProjectWorkSchedule, "schedule_version")
    assert hasattr(ProjectWorkSchedule, "supersedes_id")
