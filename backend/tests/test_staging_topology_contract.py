"""The staging topology must not repeat what scripts/deploy-prod.sh did.

Before infra/staging/ existed, the only deployment-shaped artefact in the
repository was scripts/deploy-prod.sh:

    export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://renova:renova@localhost:5433/renova}"
    cd backend && source .venv/bin/activate
    alembic upgrade head
    uvicorn app.main:app --host 0.0.0.0 --port 8100

A local virtualenv instead of the immutable image, default credentials in the
default, migration and serving fused into one process, no proxy headers, no
health gate, no rollback. These tests pin the properties that distinguish the
replacement from that.
"""
from __future__ import annotations

from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

_REPO_ROOT = Path(__file__).resolve().parents[2]
_COMPOSE = _REPO_ROOT / "infra" / "staging" / "docker-compose.yml"
_README = _REPO_ROOT / "infra" / "staging" / "README.md"
_LEGACY_SCRIPT = _REPO_ROOT / "scripts" / "deploy-prod.sh"


def _without_comments(text: str) -> str:
    """Both files quote the old script in order to explain it.

    A naive grep would match the explanation instead of the behaviour.
    """
    return "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )


@pytest.fixture(scope="module")
def compose() -> dict:
    return yaml.safe_load(_COMPOSE.read_text(encoding="utf-8"))


def test_every_documented_role_is_defined(compose: dict):
    assert set(compose["services"]) == {"postgres", "redis", "migrate", "api", "worker"}


def test_the_image_is_pinned_by_digest_and_required(compose: dict):
    raw = _without_comments(_COMPOSE.read_text(encoding="utf-8"))

    assert "ghcr.io/petrfedin/renova-api@${RENOVA_IMAGE_DIGEST" in raw
    # `:?` makes compose refuse to start rather than resolve to a floating tag.
    assert "RENOVA_IMAGE_DIGEST:?" in raw
    assert ":latest" not in raw


def test_api_and_worker_run_the_same_artifact(compose: dict):
    services = compose["services"]

    assert services["api"]["image"] == services["worker"]["image"]
    assert services["api"]["image"] == services["migrate"]["image"]


def test_api_and_worker_are_separate_process_roles(compose: dict):
    services = compose["services"]

    assert services["api"]["command"] == ["renova-api"]
    assert services["worker"]["command"] == ["renova-worker"]


def test_migration_is_a_one_shot_that_gates_traffic(compose: dict):
    services = compose["services"]

    assert services["migrate"]["command"] == ["alembic", "upgrade", "head"]
    # A failed migration must stop the promotion, not restart forever.
    assert services["migrate"]["restart"] == "no"

    for role in ("api", "worker"):
        gate = services[role]["depends_on"]["migrate"]
        assert gate["condition"] == "service_completed_successfully"


def test_datastores_are_not_exposed_to_the_host(compose: dict):
    for role in ("postgres", "redis"):
        assert "ports" not in compose["services"][role], (
            f"{role} must not be reachable from outside the compose network"
        )


def test_the_api_is_bound_to_loopback_behind_a_proxy(compose: dict):
    assert compose["services"]["api"]["ports"] == ["127.0.0.1:8100:8100"]


def test_proxy_trust_is_mandatory(compose: dict):
    raw = _without_comments(_COMPOSE.read_text(encoding="utf-8"))

    # request.client.host drives the rate-limit bucket, the provider IP
    # allowlist and the audit trail.
    assert "FORWARDED_ALLOW_IPS:?" in raw


def test_no_credential_has_a_default(compose: dict):
    raw = _without_comments(_COMPOSE.read_text(encoding="utf-8"))

    assert "POSTGRES_PASSWORD:?" in raw
    assert "renova:renova@" not in raw, "the old script's default credentials"


def test_deployed_policy_flags_are_closed(compose: dict):
    raw = _without_comments(_COMPOSE.read_text(encoding="utf-8"))

    assert 'ENVIRONMENT: staging' in raw
    assert 'ALLOW_CREATE_ALL: "false"' in raw
    assert 'ALLOW_DEMO_SEED: "false"' in raw
    assert 'AUTH_ALLOW_HEADER_USER_ID: "false"' in raw


def test_datastores_persist(compose: dict):
    assert set(compose["volumes"]) == {"renova_staging_pg", "renova_staging_redis"}


def test_both_datastores_are_health_gated(compose: dict):
    for role in ("postgres", "redis"):
        assert "healthcheck" in compose["services"][role]
    for role in ("api", "worker"):
        depends = compose["services"][role]["depends_on"]
        assert depends["postgres"]["condition"] == "service_healthy"
        assert depends["redis"]["condition"] == "service_healthy"


def test_the_worker_gets_time_to_finish_an_in_flight_job(compose: dict):
    assert compose["services"]["worker"]["stop_grace_period"] == "60s"


def test_the_runbook_does_not_overclaim(compose: dict):
    readme = _README.read_text(encoding="utf-8")

    # Each of these is an open blocker in PRODUCTION-READINESS.md; a compose
    # file must not be read as closing them.
    for issue in ("#233", "#234", "#235", "#236", "#237"):
        assert issue in readme


def test_the_legacy_script_is_kept_but_refuses_to_run():
    """Removing it would silently break anything that still calls it."""
    assert _LEGACY_SCRIPT.is_file()
    source = _LEGACY_SCRIPT.read_text(encoding="utf-8")

    assert "exit 1" in source
    assert "infra/staging" in source
    # It must no longer actually serve. The old body survives as a quoted
    # comment, and the refusal message names uvicorn to explain why — so assert
    # on execution, not on the word appearing anywhere.
    code = _without_comments(source)
    assert "exec " not in code, "the script must not exec anything"
    assert ".venv/bin/activate" not in code
    assert "alembic upgrade head" not in code
    assert code.rstrip().endswith("exit 1")
