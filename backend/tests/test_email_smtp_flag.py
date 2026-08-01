"""Email is preview-only when SMTP_HOST is empty."""
import logging

import pytest

from app.services import email_stub


@pytest.mark.asyncio
async def test_send_email_preview_without_smtp(monkeypatch, caplog):
    from app.core import config

    monkeypatch.setattr(config.settings, "smtp_host", None)
    with caplog.at_level(logging.WARNING, logger="renova.email"):
        await email_stub.send_email("a@b.c", "subj", "body text")
    assert any("EMAIL preview only to=a@b.c" in record.message for record in caplog.records)
