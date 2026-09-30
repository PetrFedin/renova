"""_stored_link must percent-encode return_to so a query inside it stays intact."""
from urllib.parse import parse_qs, urlsplit

from app.services.notification_service import _stored_link


def test_return_to_with_query_is_encoded_single_question_mark():
    link = _stored_link("/stage/s1", "/(customer)/(tabs)/repair?tab=control&filter=x")
    assert link.count("?") == 1
    parts = urlsplit(link)
    assert parts.path == "/stage/s1"
    assert parse_qs(parts.query) == {"returnTo": ["/(customer)/(tabs)/repair?tab=control&filter=x"]}


def test_existing_query_gets_ampersand_and_plain_return_to_unchanged():
    assert _stored_link("/stage/s1?projectId=p1", "/(customer)/(tabs)/") == (
        "/stage/s1?projectId=p1&returnTo=/(customer)/(tabs)/"
    )


def test_missing_parts_passthrough():
    assert _stored_link("/documents", None) == "/documents"
    assert _stored_link(None, "/x") is None
