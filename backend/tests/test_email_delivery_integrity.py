from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core import environment
from app.services import automation_reminders_worker as worker
from app.services import email_service


@pytest.fixture(autouse=True)
def restore_worker_state():
    snapshot = dict(worker._METRICS)
    sent = worker._ops_alert_sent_for_streak
    yield
    worker._METRICS.clear()
    worker._METRICS.update(snapshot)
    worker._ops_alert_sent_for_streak = sent


@pytest.fixture
def email_settings(monkeypatch):
    monkeypatch.setattr(email_service.settings, "environment", "test")
    monkeypatch.setattr(email_service.settings, "smtp_host", None)
    monkeypatch.setattr(email_service.settings, "smtp_port", 587)
    monkeypatch.setattr(email_service.settings, "smtp_user", None)
    monkeypatch.setattr(email_service.settings, "smtp_password", None)
    monkeypatch.setattr(email_service.settings, "smtp_from", None)
    monkeypatch.setattr(email_service.settings, "smtp_use_tls", True)


@pytest.mark.asyncio
async def test_local_missing_smtp_is_explicit_preview_not_success(monkeypatch, email_settings, caplog):
    result = await email_service.send_email(
        "ops@example.com",
        "Worker alert",
        "sensitive body must not be logged",
    )

    assert result is False
    assert "preview only" in caplog.text
    assert "sensitive body must not be logged" not in caplog.text


@pytest.mark.asyncio
async def test_production_missing_smtp_fails_closed(monkeypatch, email_settings):
    monkeypatch.setattr(email_service.settings, "environment", "production")

    with pytest.raises(email_service.EmailConfigurationError, match="smtp_host_missing"):
        await email_service.send_email("ops@example.com", "Worker alert", "body")


@pytest.mark.asyncio
async def test_configured_smtp_returns_true_only_after_sync_sender_finishes(monkeypatch, email_settings):
    monkeypatch.setattr(email_service.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(email_service.settings, "smtp_from", "renova@example.com")
    calls = []

    def accepted(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(email_service, "_smtp_send_sync", accepted)

    result = await email_service.send_email("ops@example.com", "Worker alert", "body")

    assert result is True
    assert calls == [{"to": "ops@example.com", "subject": "Worker alert", "body": "body"}]


@pytest.mark.asyncio
async def test_configured_smtp_failure_never_falls_back_to_log_success(monkeypatch, email_settings):
    monkeypatch.setattr(email_service.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(email_service.settings, "smtp_from", "renova@example.com")

    def failed(**_kwargs):
        raise OSError("network down")

    monkeypatch.setattr(email_service, "_smtp_send_sync", failed)

    with pytest.raises(email_service.EmailDeliveryFailed, match="smtp_delivery_failed"):
        await email_service.send_email("ops@example.com", "Worker alert", "body")


class FakeSmtp:
    refused = {}
    instances = []

    def __init__(self, host, port, timeout):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.login_args = None
        self.message = None
        type(self).instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def starttls(self):
        self.started_tls = True

    def login(self, user, password):
        self.login_args = (user, password)

    def send_message(self, message):
        self.message = message
        return dict(type(self).refused)


def test_smtp_sync_checks_tls_login_headers_and_recipient_refusal(monkeypatch, email_settings):
    FakeSmtp.instances.clear()
    FakeSmtp.refused = {}
    monkeypatch.setattr(email_service.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(email_service.settings, "smtp_user", "renova@example.com")
    monkeypatch.setattr(email_service.settings, "smtp_password", "secret")
    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSmtp)

    email_service._smtp_send_sync(to="ops@example.com", subject="Alert", body="body")

    smtp = FakeSmtp.instances[-1]
    assert (smtp.host, smtp.port, smtp.timeout) == ("smtp.example.com", 587, 15)
    assert smtp.started_tls is True
    assert smtp.login_args == ("renova@example.com", "secret")
    assert smtp.message["From"] == "renova@example.com"
    assert smtp.message["To"] == "ops@example.com"

    FakeSmtp.refused = {"ops@example.com": (550, b"rejected")}
    with pytest.raises(email_service.EmailDeliveryFailed, match="smtp_recipient_refused"):
        email_service._smtp_send_sync(to="ops@example.com", subject="Alert", body="body")


@pytest.mark.parametrize(
    ("recipient", "subject"),
    [
        ("ops@example.com\nBcc: attacker@example.com", "Alert"),
        ("Ops <ops@example.com>", "Alert"),
        ("ops@example.com", "Alert\r\nX-Injected: yes"),
        ("not-an-email", "Alert"),
    ],
)
def test_email_headers_reject_injection_and_ambiguous_addresses(recipient, subject):
    with pytest.raises(email_service.EmailConfigurationError):
        email_service._recipient(recipient)
        email_service._clean_header(subject, field="subject", max_length=255)


def production_settings(**overrides):
    values = {
        "environment": "production",
        "database_url": "postgresql+asyncpg://renova:secret@db/renova",
        "public_base_url": "https://api.renova.example",
        "secret_key": "production-secret-key-32-characters",
        "ops_alert_email": None,
        "smtp_host": None,
        "smtp_port": 587,
        "smtp_user": None,
        "smtp_password": None,
        "smtp_from": None,
        "redis_url": "rediss://redis.example.com:6379/0",
        "twilio_sid": "synthetic-account-id-for-tests",
        "twilio_token": "synthetic-provider-token-for-tests",
        "twilio_from": "+74951234567",
    }
    values.update(overrides)
    return values


def test_production_ops_alert_requires_working_smtp_configuration():
    with pytest.raises(ValueError, match="OPS_ALERT_EMAIL задан, но SMTP_HOST отсутствует"):
        environment.validate_runtime_settings(
            **production_settings(ops_alert_email="ops@example.com")
        )

    policy = environment.validate_runtime_settings(
        **production_settings(
            ops_alert_email="ops@example.com",
            smtp_host="smtp.example.com",
            smtp_from="renova@example.com",
        )
    )
    assert policy.name == "production"


def test_partial_or_invalid_smtp_configuration_is_rejected_before_traffic():
    with pytest.raises(ValueError, match="SMTP_USER задан без SMTP_PASSWORD"):
        environment.validate_runtime_settings(
            **production_settings(
                smtp_host="smtp.example.com",
                smtp_user="renova@example.com",
                smtp_from="renova@example.com",
            )
        )

    with pytest.raises(ValueError, match="SMTP_PORT"):
        environment.validate_runtime_settings(
            **production_settings(smtp_port=70000)
        )

    with pytest.raises(ValueError, match="OPS_ALERT_EMAIL имеет некорректный формат"):
        environment.validate_runtime_settings(
            **production_settings(ops_alert_email="not-an-email")
        )


def test_development_preview_is_visible_as_configuration_warning():
    warnings = environment.collect_warnings(
        environment="development",
        database_url="sqlite+aiosqlite:///./renova.db",
        secret_key="dev-secret-change-me",
        ops_alert_email="ops@example.com",
        smtp_host=None,
    )
    assert any("preview only" in warning for warning in warnings)


def prepare_alert_state(monkeypatch):
    worker._METRICS["consecutive_failures"] = 3
    worker._METRICS["last_error"] = "RuntimeError: failed"
    worker._METRICS["last_tick_at"] = "2026-07-30T12:00:00Z"
    worker._ops_alert_sent_for_streak = False
    monkeypatch.setattr(worker, "settings", SimpleNamespace(ops_alert_email="ops@example.com"), raising=False)


@pytest.mark.asyncio
async def test_ops_alert_preview_does_not_suppress_future_retry(monkeypatch):
    prepare_alert_state(monkeypatch)
    monkeypatch.setattr(email_service, "send_ops_alert_email", AsyncMock(return_value=False))
    monkeypatch.setattr("app.core.config.settings.ops_alert_email", "ops@example.com")

    await worker._maybe_ops_alert()

    assert worker._ops_alert_sent_for_streak is False
    assert worker._METRICS["ops_alert_last_status"] == "preview"
    assert worker._METRICS["ops_alert_last_error"] == "smtp_not_configured_local_preview"


@pytest.mark.asyncio
async def test_ops_alert_failure_remains_retryable_and_observable(monkeypatch):
    prepare_alert_state(monkeypatch)
    monkeypatch.setattr(
        email_service,
        "send_ops_alert_email",
        AsyncMock(side_effect=email_service.EmailDeliveryFailed("smtp_delivery_failed")),
    )
    monkeypatch.setattr("app.core.config.settings.ops_alert_email", "ops@example.com")

    await worker._maybe_ops_alert()

    assert worker._ops_alert_sent_for_streak is False
    assert worker._METRICS["ops_alert_last_status"] == "failed"
    assert "smtp_delivery_failed" in worker._METRICS["ops_alert_last_error"]


@pytest.mark.asyncio
async def test_ops_alert_success_marks_only_current_failure_streak(monkeypatch):
    prepare_alert_state(monkeypatch)
    sender = AsyncMock(return_value=True)
    monkeypatch.setattr(email_service, "send_ops_alert_email", sender)
    monkeypatch.setattr("app.core.config.settings.ops_alert_email", "ops@example.com")

    await worker._maybe_ops_alert()
    await worker._maybe_ops_alert()

    assert worker._ops_alert_sent_for_streak is True
    assert worker._METRICS["ops_alert_last_status"] == "sent"
    assert worker._METRICS["ops_alert_last_error"] is None
    assert sender.await_count == 1


def test_main_wires_smtp_settings_into_startup_guard():
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "main.py").read_text(encoding="utf-8")
    assert "ops_alert_email=settings.ops_alert_email" in source
    assert "smtp_host=settings.smtp_host" in source
    assert "smtp_password=settings.smtp_password" in source
