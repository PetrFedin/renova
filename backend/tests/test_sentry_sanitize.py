"""Sentry before_send sanitization."""
from app.core.sentry_sanitize import redact_mapping, sentry_before_send


def test_redacts_authorization_header():
    event = {
        "request": {
            "headers": {"Authorization": "Bearer super-secret-token", "Content-Type": "application/json"},
            "data": {"password": "hunter2", "ok": True},
        },
        "extra": {"access_token": "abc", "project_id": "p1"},
    }
    out = sentry_before_send(event, {})
    assert out["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert out["request"]["headers"]["Content-Type"] == "application/json"
    assert out["request"]["data"]["password"] == "[REDACTED]"
    assert out["request"]["data"]["ok"] is True
    assert out["extra"]["access_token"] == "[REDACTED]"
    assert out["extra"]["project_id"] == "p1"


def test_redacts_bearer_in_strings():
    assert "[REDACTED]" in redact_mapping("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xx")


def test_redacts_large_document_body():
    big = "x" * 3000
    assert redact_mapping({"document_content": big})["document_content"] == "[REDACTED]"
    assert redact_mapping(big) == "[REDACTED_LARGE_BODY]"


def test_redacts_payment_and_message_keys():
    data = redact_mapping(
        {
            "payment_requisite": "40817810...",
            "personal_message": "привет",
            "file_body": "PDFBYTES",
        }
    )
    assert data["payment_requisite"] == "[REDACTED]"
    assert data["personal_message"] == "[REDACTED]"
    assert data["file_body"] == "[REDACTED]"
