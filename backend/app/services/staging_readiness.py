"""H0 / W53: staging readiness checklist for investors & pilots (no secrets)."""
from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.core.environment import _is_https, _is_localhost_url, normalize_environment
from app.services.yookassa_service import yookassa_health
from app.services.fns.receipt_verify import fns_receipt_health


def build_h0_readiness() -> dict[str, Any]:
    """Сводка H0: что блокирует демо инвестору (keys / URL / honesty)."""
    env = normalize_environment(settings.environment)
    yk = yookassa_health()
    fns = fns_receipt_health()
    public = (settings.public_base_url or "").strip()

    checks: list[dict[str, Any]] = []

    def add(id_: str, label: str, ok: bool, how: str) -> None:
        checks.append({"id": id_, "label": label, "ok": ok, "how": how})

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

    # Блокеры пилота = обязательные H0
    blocker_ids = {"public_url", "public_https", "yookassa_keys", "yookassa_live", "yookassa_no_demo"}
    if env == "development":
        # В development localhost OK — не красим красным весь чеклист
        for c in checks:
            if c["id"] in ("public_url", "public_https", "yookassa_no_demo"):
                c["ok"] = True
                c["how"] = "development: localhost/demo допустимы; для пилота переключите staging"

    blockers = [c for c in checks if c["id"] in blocker_ids and not c["ok"]]
    ready = len(blockers) == 0 and env in ("staging", "production")
    score = round(100 * sum(1 for c in checks if c["ok"]) / max(len(checks), 1))

    return {
        "environment": env,
        "ready_for_investor_demo": ready,
        "score": score,
        "blockers": blockers,
        "checks": checks,
        "public_base_url_host": public.split("/")[2] if public.startswith("http") else public[:40],
        "hint": (
            "Готово к демо инвестору"
            if ready
            else "Закройте blockers: HTTPS API + YuKassa live keys, затем TestFlight"
        ),
    }
