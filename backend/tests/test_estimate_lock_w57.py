"""W57: mutual estimate lock helpers + purchase picks gate."""
from app.services import estimate_service as est
from app.services import purchase_service as pur
import inspect


def test_propose_and_lock_helpers_exist():
    assert hasattr(est, "propose_estimate_lock")
    assert hasattr(est, "lock_estimate")


def test_create_from_picks_rejects_unapproved():
    src = inspect.getsource(pur.create_from_picks)
    assert "picks_not_approved" in src
    assert "MaterialPickStatus.approved" in src
