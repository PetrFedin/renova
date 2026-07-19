"""Email uses stub when SMTP_HOST empty."""
import logging

import pytest

from app.services import email_stub


@pytest.mark.asyncio
async def test_send_email_stub_without_smtp(monkeypatch, caplog):
    from app.core import config

    monkeypatch.setattr(config.settings, "smtp_host", None)
    with caplog.at_level(logging.INFO, logger="renova.email"):
        await email_stub.send_email("a@b.c", "subj", "body text")
    assert any("EMAIL to=a@b.c" in r.message for r in caplog.records)
