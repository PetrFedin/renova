"""Release health must distinguish configuration from measured telemetry."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.release_health_service import truthful_release_snapshot
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

_RELEASE_ENV = (
    "RENOVA_GIT_SHA",
    "RENOVA_IMAGE_DIGEST",
    "RELEASE_VERSION",
    "APP_VERSION",
    "RELEASE_COMMIT_SHA",
    "GIT_SHA",
    "RENDER_GIT_COMMIT",
    "RAILWAY_GIT_COMMIT_SHA",
)


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    for name in _RELEASE_ENV:
        monkeypatch.delenv(name, raising=False)
    db_path = tmp_path / "release_health.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setattr(cfg.settings, "database_url", url)
    monkeypatch.setattr(cfg.settings, "environment", "development")
    monkeypatch.setattr(cfg.settings, "sentry_dsn", None)
    monkeypatch.setattr(cfg.settings, "otel_exporter_otlp_endpoint", None)
    monkeypatch.setattr(cfg.settings, "otel_exporter_otlp_insecure", False)
    monkeypatch.setattr(cfg.settings, "log_json", False)

    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)
    yield
    await sess.engine.dispose()


async def _login(client: AsyncClient, role: str):
    response = await client.post("/api/v1/auth/demo", json={"role": role})
    assert response.status_code == 200, response.text
    return {"X-User-Id": response.json()["id"]}


def test_snapshot_has_no_fabricated_identity_or_metrics():
    snapshot = truthful_release_snapshot()

    assert snapshot["contract_version"] == 2
    assert snapshot["release"] == {
        "version": None,
        "version_source": None,
        "commit_sha": None,
        "commit_source": None,
        "identified": False,
    }
    observability = snapshot["observability"]
    assert observability["status"] == "not_configured"
    assert observability["configured"] is False
    assert observability["sdk_active"] is False
    assert observability["runtime_error"] is None
    assert observability["sentry"] == {
        "configured": False,
        "sdk_active": False,
        "external_ingestion_confirmed": False,
    }
    assert observability["otel"]["configured"] is False
    assert observability["otel"]["external_ingestion_confirmed"] is False
    assert observability["structured_logs"]["enabled"] is False
    assert observability["structured_logs"]["external_ingestion_confirmed"] is False
    assert observability["artifact"] == {"git_sha": None, "image_digest": None}
    assert observability["external_confirmations"] == {
        "sentry_ingestion": False,
        "otlp_ingestion": False,
        "structured_log_ingestion": False,
        "alert_delivery": False,
    }
    assert observability["metrics"] == {
        "source": "unavailable",
        "available": False,
        "reason": "sentry_dsn_not_configured",
        "crash_free_rate": None,
        "sessions": None,
    }


def test_configured_observability_is_not_external_delivery_proof(monkeypatch):
    monkeypatch.setattr(cfg.settings, "sentry_dsn", "https://public@example.invalid/1")
    monkeypatch.setattr(
        cfg.settings,
        "otel_exporter_otlp_endpoint",
        "https://otel.example.invalid:4317",
    )
    monkeypatch.setattr(cfg.settings, "log_json", True)
    monkeypatch.setenv("RENOVA_GIT_SHA", "abc123")
    monkeypatch.setenv("RENOVA_IMAGE_DIGEST", "sha256:deadbeef")

    snapshot = truthful_release_snapshot()
    observability = snapshot["observability"]

    assert observability["status"] in {"configured_unverified", "degraded"}
    assert observability["sentry"]["configured"] is True
    assert observability["otel"]["configured"] is True
    assert observability["structured_logs"]["enabled"] is True
    assert observability["artifact"] == {
        "git_sha": "abc123",
        "image_digest": "sha256:deadbeef",
    }
    assert all(value is False for value in observability["external_confirmations"].values())
    assert observability["metrics"]["available"] is False


def test_release_identity_prefers_canonical_immutable_image_sha(monkeypatch):
    monkeypatch.setenv("RELEASE_VERSION", "2026.08.05")
    monkeypatch.setenv("RENOVA_GIT_SHA", "canonicalabcdef1234567890")
    monkeypatch.setenv("RELEASE_COMMIT_SHA", "legacyabcdef1234567890")

    release = truthful_release_snapshot()["release"]

    assert release == {
        "version": "2026.08.05",
        "version_source": "RELEASE_VERSION",
        "commit_sha": "canonicalabcdef1234567890",
        "commit_source": "RENOVA_GIT_SHA",
        "identified": True,
    }


async def test_release_health_api_is_truthful_and_backward_compatible(monkeypatch):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        contractor_headers = await _login(client, "contractor")
        customer_headers = await _login(client, "customer")

        anonymous_identity = await client.get(
            "/api/v1/admin/release-health",
            headers=contractor_headers,
        )
        forbidden = await client.get(
            "/api/v1/admin/release-health",
            headers=customer_headers,
        )

        monkeypatch.setenv("RELEASE_VERSION", "2.4.1")
        monkeypatch.setenv("GIT_SHA", "feedfacecafebeef")
        identified = await client.get(
            "/api/v1/admin/release-health",
            headers=contractor_headers,
        )

    assert anonymous_identity.status_code == 200, anonymous_identity.text
    body = anonymous_identity.json()
    assert body["version"] is None
    assert body["commit_sha"] is None
    assert body["crash_free_rate"] is None
    assert body["sessions"] is None
    assert body["source"] == "unavailable"
    assert body["observability"]["metrics"]["available"] is False
    assert body["observability"]["external_confirmations"]["alert_delivery"] is False
    assert "dsn" not in body["observability"]
    assert body["integrations"]["outbox"] is not None
    assert body["integrations"]["smtp"] == {
        "configured": False,
        "ops_alert_recipient_configured": False,
        "tls_enabled": True,
        "status": "not_configured",
        "external_delivery_confirmed": False,
    }
    assert body["integrations"]["document_ocr"] == {
        "mode": "metadata",
        "status": "metadata_only",
        "content_ocr_available": False,
        "content_read": False,
        "runtime_owner": "renova-worker",
    }

    assert forbidden.status_code == 403

    assert identified.status_code == 200, identified.text
    identified_body = identified.json()
    assert identified_body["version"] == "2.4.1"
    assert identified_body["commit_sha"] == "feedfacecafebeef"
    assert identified_body["release"]["version_source"] == "RELEASE_VERSION"
    assert identified_body["release"]["commit_source"] == "GIT_SHA"
