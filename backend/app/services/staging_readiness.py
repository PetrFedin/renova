"""H0 / W53: staging readiness checklist for investors & pilots (no secrets)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.environment import _is_https, _is_localhost_url, normalize_environment
from app.services.admin_identity_service import inspect_admin_identities
from app.services.fns.receipt_verify import fns_receipt_health
from app.services.yookassa_service import yookassa_health


_BLOCKER_IDS = {
    "public_url",
    "public_https",
    "yookassa_keys",
    "yookassa_live",
    "yookassa_no_demo",
    "auth_bearer",
    "admin_identity",
}


def _git_sha() -> str | None:
    import os
    import subprocess

    for key in (
        "GIT_SHA",
        "COMMIT_SHA",
        "SOURCE_VERSION",
        "RENDER_GIT_COMMIT",
        "HEROKU_SLUG_COMMIT",
    ):
        value = (os.environ.get(key) or "").strip()
        if value:
            return value[:40]
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(Path(__file__).resolve().parents[2]),
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        return out.decode().strip()[:40]
    except Exception:
        return None


def _finalize(payload: dict[str, Any]) -> dict[str, Any]:
    checks = payload["checks"]
    env = payload["environment"]
    blockers = [
        check
        for check in checks
        if check["id"] in _BLOCKER_IDS and not check["ok"]
    ]
    ready = len(blockers) == 0 and env in ("staging", "production")
    payload["blockers"] = blockers
    payload["ready_for_investor_demo"] = ready
    payload["score"] = round(
        100 * sum(1 for check in checks if check["ok"]) / max(len(checks), 1)
    )
    payload["hint"] = (
        "Готово к демо инвестору"
        if ready
        else "Закройте blockers: HTTPS API + YuKassa live keys + ADMIN_USER_IDS"
    )
    return payload


def build_h0_readiness() -> dict[str, Any]:
    """Сводка H0: configuration blockers without live database reads."""
    env = normalize_environment(settings.environment)
    yk = yookassa_health()
    fns = fns_receipt_health()
    public = (settings.public_base_url or "").strip()
    admin_config = settings.admin_identity_config
    is_working = env in ("staging", "production")

    checks: list[dict[str, Any]] = []

    def add(id_: str, label: str, ok: bool, how: str, **metadata: Any) -> None:
        checks.append(
            {"id": id_, "label": label, "ok": ok, "how": how, **metadata}
        )

    add(
        "env",
        f"ENVIRONMENT={env}",
        env in ("staging", "production", "development", "test"),
        "Задайте ENVIRONMENT=staging на сервере пилота",
    )
    add(
        "public_url",
        "PUBLIC_BASE_URL не localhost",
        bool(public) and not _is_localhost_url(public),
        "HTTPS API URL для TestFlight (не 127.0.0.1)",
    )
    add(
        "public_https",
        "PUBLIC_BASE_URL по HTTPS",
        bool(public) and _is_https(public),
        "Нужен https://… для внешних тестеров (H0.1)",
    )
    add(
        "yookassa_keys",
        "ЮKassa ключи заданы",
        bool(yk.get("configured")),
        "YOOKASSA_SHOP_ID + YOOKASSA_SECRET",
    )
    add(
        "yookassa_live",
        "ЮKassa live checkout ready",
        bool(yk.get("live_checkout_ready")),
        "staging/production + configured keys (demo выключен)",
    )
    add(
        "yookassa_no_demo",
        "Demo-оплата выключена",
        not bool(yk.get("demo_allowed")),
        "В staging demo_allowed должен быть false",
    )
    add(
        "fns_live",
        "ФНС verify live (опционально)",
        bool(fns.get("live_verify_ready")),
        "FNS_RECEIPT_LOGIN/PASSWORD — не блокер пилота",
    )
    kontur = (settings.kontur_mode or "off").strip().lower()
    add(
        "esign",
        "Kontur sandbox/live или in_app",
        kontur in ("sandbox", "live", "off"),
        "Без ключей — in_app подпись (честно)",
    )
    add(
        "auth_bearer",
        "Identity только JWT Bearer (без X-User-Id)",
        not bool(settings.allow_header_user_id),
        "AUTH_ALLOW_HEADER_USER_ID запрещён на staging/production",
    )
    add(
        "admin_identity",
        "Администраторы заданы явно, однозначно и подтверждены в БД",
        admin_config.is_strictly_valid and not is_working,
        "Задайте ADMIN_USER_IDS без пустых элементов и дублей; live preflight проверит БД",
        **admin_config.public_diagnostics(),
        database_checked=False,
        database_ok=None,
        valid_contractor_count=None,
        missing_count=None,
        wrong_role_count=None,
    )

    if env == "development":
        for check in checks:
            if check["id"] in (
                "public_url",
                "public_https",
                "yookassa_no_demo",
                "auth_bearer",
                "admin_identity",
            ):
                check["ok"] = True
                check["how"] = (
                    "development: localhost/demo/X-User-Id/contractor-admin допустимы; "
                    "для пилота переключите staging"
                )

    from datetime import datetime, timezone

    return _finalize(
        {
            "environment": env,
            "ready_for_investor_demo": False,
            "score": 0,
            "blockers": [],
            "checks": checks,
            "public_base_url_host": (
                public.split("/")[2] if public.startswith("http") else public[:40]
            ),
            "git_sha": _git_sha(),
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "hint": "",
        }
    )


async def build_h0_readiness_with_database(
    db: AsyncSession,
) -> dict[str, Any]:
    """Augment H0 with aggregate DB identity checks; never expose user IDs."""
    payload = build_h0_readiness()
    env = payload["environment"]
    if env not in ("staging", "production"):
        return payload

    admin_config = settings.admin_identity_config
    admin_check = next(
        check for check in payload["checks"] if check["id"] == "admin_identity"
    )
    admin_check["database_checked"] = False
    if not admin_config.is_strictly_valid:
        return _finalize(payload)

    state = await inspect_admin_identities(db, admin_config.configured_ids)
    admin_check.update(state.public_diagnostics())
    admin_check["database_checked"] = True
    admin_check["ok"] = admin_config.is_strictly_valid and state.ok
    if not state.ok:
        admin_check["how"] = (
            "Все ADMIN_USER_IDS должны существовать в users и иметь role=contractor; "
            "идентификаторы в ответе не раскрываются"
        )
    return _finalize(payload)
