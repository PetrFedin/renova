"""P2.20 short-lived WS tickets."""
from app.services.ws_ticket_service import issue_ws_ticket, consume_ws_ticket


def test_issue_and_consume():
    ticket, ttl = issue_ws_ticket("user-1", ttl=60)
    assert ttl == 60
    assert consume_ws_ticket(ticket) == "user-1"
    assert consume_ws_ticket("nope") is None
