"""P2.17 — full address only for customer / assigned contractor."""
from app.api.v1.marketplace import _location_public, _can_see_full_address
from app.models.entities import JobLead, User, UserRole


def test_location_public_truncates():
    assert _location_public("Москва, ЦАО, ул. Тверская 1") == "Москва, ЦАО"
    assert _location_public(None) is None


def test_full_address_acl():
    lead = JobLead(customer_id="c1", title="t", assigned_contractor_id="x1")
    cust = User(id="c1", phone="+1", role=UserRole.customer)
    assigned = User(id="x1", phone="+2", role=UserRole.contractor)
    other = User(id="z9", phone="+3", role=UserRole.contractor)
    assert _can_see_full_address(lead, cust) is True
    assert _can_see_full_address(lead, assigned) is True
    assert _can_see_full_address(lead, other) is False
