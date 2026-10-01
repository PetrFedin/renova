"""Единый реестр внешних интеграций: что нужно, что задано, что на заглушке.

Зачем. Код каждой интеграции уже живёт в своём сервисе (Twilio — ``sms_service``, ЮKassa —
``yookassa_service``, S3 — ``storage_service``, Контур — ``esign.kontur`` и т.д.). Реестр их не
дублирует и ничего не вызывает по сети: он описывает *конфигурацию* — какой провайдер выбран
настройками, каких env-ключей не хватает и должен ли production отказать в старте.

Правила честности:
- провайдер выбирается настройкой (задан хотя бы один ключ / режим / флаг). Не выбран — работает
  ``stub``-провайдер со статусом ``stub``/``not_configured``; успеха он никогда не изображает;
- ``configured`` означает «все обязательные ключи заданы и согласованы», а НЕ «провайдер ответил».
  Живой проверки реестр не делает, поэтому ``live_verified`` всегда ``False``;
- наружу уходят только имена env-ключей и булевы признаки, значения секретов — никогда;
- ``push`` и часть e-sign/НПД зависят от внешних действий вне бэкенда (APNs/FCM в EAS) — они
  описаны как ``manual_prerequisites`` и состояние ``external_only``.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Protocol
from urllib.parse import urlparse

from app.core.config import Settings

# --- состояния ---------------------------------------------------------------
CONFIGURED = "configured"        # провайдер выбран, все обязательные ключи на месте
STUB = "stub"                    # провайдер не выбран; работает честная заглушка
PARTIAL = "partial"              # выбран, но часть ключей отсутствует/некорректна
EXTERNAL_ONLY = "external_only"  # на бэкенде настраивать нечего; нужны внешние действия

WORKING_ENVIRONMENTS = frozenset({"staging", "production"})


def _set(value: object) -> bool:
    return bool(str(value or "").strip())


@dataclass(frozen=True)
class Evaluation:
    """Результат оценки конфигурации одного провайдера (без значений секретов)."""

    provider: str
    state: str
    missing_keys: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()


class IntegrationProvider(Protocol):
    """Протокол провайдера интеграции."""

    name: str
    is_stub: bool

    def selected(self, s: Settings) -> bool:
        """Выбран ли этот провайдер настройками."""

    def evaluate(self, s: Settings) -> Evaluation:
        """Оценить конфигурацию. Сети не касается."""


@dataclass(frozen=True)
class KeyedProvider:
    """Провайдер, выбираемый наличием ключей/режима, с обязательным набором env-ключей."""

    name: str
    selected_fn: Callable[[Settings], bool]
    required: Callable[[Settings], tuple[str, ...]]  # имена env-ключей, которых не хватает
    notes_fn: Callable[[Settings], tuple[str, ...]] = lambda s: ()
    is_stub: bool = False

    def selected(self, s: Settings) -> bool:
        return self.selected_fn(s)

    def evaluate(self, s: Settings) -> Evaluation:
        missing = self.required(s)
        return Evaluation(
            provider=self.name,
            state=PARTIAL if missing else CONFIGURED,
            missing_keys=missing,
            notes=self.notes_fn(s),
        )


@dataclass(frozen=True)
class StubProvider:
    """Заглушка по умолчанию: честно «не настроено», ключи для настройки — в missing_keys."""

    name: str
    all_keys: tuple[str, ...]
    note: str
    is_stub: bool = True

    def selected(self, s: Settings) -> bool:  # pragma: no cover - выбирается по умолчанию
        return True

    def evaluate(self, s: Settings) -> Evaluation:
        return Evaluation(self.name, STUB, self.all_keys, (self.note,))


@dataclass(frozen=True)
class ExternalOnlyProvider:
    """Интеграция, чьи реквизиты лежат вне бэкенда (например APNs/FCM в EAS)."""

    name: str
    note: str
    is_stub: bool = False

    def selected(self, s: Settings) -> bool:
        return True

    def evaluate(self, s: Settings) -> Evaluation:
        return Evaluation(self.name, EXTERNAL_ONLY, (), (self.note,))


@dataclass(frozen=True)
class IntegrationSpec:
    key: str
    title: str
    # fail — в production без настроенной интеграции старт отклоняется;
    # warn — предупреждение; none — только статус.
    production_policy: str
    real: tuple[IntegrationProvider, ...]
    stub: IntegrationProvider
    env_keys: tuple[str, ...] = ()
    manual_prerequisites: tuple[str, ...] = ()
    smoke: str | None = None  # как проверить после настройки
    # Критична для запуска: при settings.integrations_strict отсутствие = отказ старта.
    critical: bool = False

    def resolve(self, s: Settings) -> IntegrationProvider:
        for provider in self.real:
            if provider.selected(s):
                return provider
        return self.stub


# --- проверки ключей ----------------------------------------------------------
def _missing(s: Settings, pairs: tuple[tuple[str, str], ...]) -> tuple[str, ...]:
    return tuple(env for attr, env in pairs if not _set(getattr(s, attr, None)))


def _https_endpoint(value: str | None) -> bool:
    parsed = urlparse((value or "").strip())
    return parsed.scheme == "https" and bool(parsed.netloc)


def _local_host(value: str) -> bool:
    candidate = value.strip()
    parsed = urlparse(candidate if "://" in candidate else f"//{candidate}")
    return (parsed.hostname or "").lower() in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _yookassa_missing(s: Settings) -> tuple[str, ...]:
    return _missing(
        s,
        (
            ("yookassa_shop_id", "YOOKASSA_SHOP_ID"),
            ("yookassa_secret", "YOOKASSA_SECRET"),
            ("yookassa_webhook_secret", "YOOKASSA_WEBHOOK_SECRET"),
        ),
    )


def _yookassa_notes(s: Settings) -> tuple[str, ...]:
    base = (s.public_base_url or "").rstrip("/")
    return (f"webhook_url={base}/api/v1/subscription/webhook",)


def _moy_nalog_missing(s: Settings) -> tuple[str, ...]:
    from app.services import moy_nalog_oauth  # лениво: модуль тянет redis/crypto

    return tuple(moy_nalog_oauth.oauth_readiness().missing)


def _twilio_missing(s: Settings) -> tuple[str, ...]:
    return _missing(
        s,
        (("twilio_sid", "TWILIO_SID"), ("twilio_token", "TWILIO_TOKEN"), ("twilio_from", "TWILIO_FROM")),
    )


def _kontur_mode(s: Settings) -> str:
    return (s.kontur_mode or "off").strip().lower() or "off"


def _kontur_missing(s: Settings) -> tuple[str, ...]:
    out = list(
        _missing(
            s,
            (
                ("kontur_api_key", "KONTUR_API_KEY"),
                ("kontur_api_url", "KONTUR_API_URL"),
                ("esign_webhook_secret", "ESIGN_WEBHOOK_SECRET"),
            ),
        )
    )
    if _kontur_mode(s) not in {"sandbox", "live"}:
        out.insert(0, "KONTUR_MODE")
    return tuple(out)


def _kontur_notes(s: Settings) -> tuple[str, ...]:
    notes = [f"kontur_mode={_kontur_mode(s)}"]
    if (s.goskey_mode or "off").strip().lower() not in {"", "off"}:
        notes.append("GOSKEY_MODE должен быть off: Госключ не реализован")
    return tuple(notes)


def _s3_missing(s: Settings) -> tuple[str, ...]:
    return _missing(
        s,
        (
            ("s3_endpoint", "S3_ENDPOINT"),
            ("s3_access_key", "S3_ACCESS_KEY"),
            ("s3_secret_key", "S3_SECRET_KEY"),
            ("s3_bucket", "S3_BUCKET"),
        ),
    )


def _s3_selected(s: Settings) -> bool:
    return any(_set(v) for v in (s.s3_endpoint, s.s3_access_key, s.s3_secret_key))


def _smtp_missing(s: Settings) -> tuple[str, ...]:
    out = list(_missing(s, (("smtp_host", "SMTP_HOST"),)))
    if not (_set(s.smtp_from) or _set(s.smtp_user)):
        out.append("SMTP_FROM")
    if _set(s.smtp_user) and not _set(s.smtp_password):
        out.append("SMTP_PASSWORD")
    return tuple(out)


def _otlp_missing(s: Settings) -> tuple[str, ...]:
    endpoint = (s.otel_exporter_otlp_endpoint or "").strip()
    if not endpoint:
        return ("OTEL_EXPORTER_OTLP_ENDPOINT",)
    out: list[str] = []
    if _local_host(endpoint):
        out.append("OTEL_EXPORTER_OTLP_ENDPOINT_NOT_LOCALHOST")
    if s.otel_exporter_otlp_insecure and s.normalized_environment in WORKING_ENVIRONMENTS:
        out.append("OTEL_EXPORTER_OTLP_INSECURE_MUST_BE_FALSE")
    return tuple(out)


def _fns_receipts_missing(s: Settings) -> tuple[str, ...]:
    return _missing(
        s,
        (("fns_receipt_login", "FNS_RECEIPT_LOGIN"), ("fns_receipt_password", "FNS_RECEIPT_PASSWORD")),
    )


SPECS: tuple[IntegrationSpec, ...] = (
    IntegrationSpec(
        key="payments",
        title="Платежи: ЮKassa (создание платежа + webhook)",
        production_policy="warn",
        critical=True,
        env_keys=("YOOKASSA_SHOP_ID", "YOOKASSA_SECRET", "YOOKASSA_WEBHOOK_SECRET"),
        real=(
            KeyedProvider(
                "yookassa",
                lambda s: _set(s.yookassa_shop_id) or _set(s.yookassa_secret) or _set(s.yookassa_webhook_secret),
                _yookassa_missing,
                _yookassa_notes,
            ),
        ),
        stub=StubProvider(
            "stub",
            ("YOOKASSA_SHOP_ID", "YOOKASSA_SECRET", "YOOKASSA_WEBHOOK_SECRET"),
            "checkout отвечает 503; демо-оплата в рабочих средах отключена",
        ),
        manual_prerequisites=(
            "в личном кабинете ЮKassa зарегистрировать webhook на {PUBLIC_BASE_URL}/api/v1/subscription/webhook",
            "за балансировщиком задать FORWARDED_ALLOW_IPS (иначе IP-allowlist вебхука не сработает)",
        ),
        smoke="тестовый платёж и возврат в магазине ЮKassa; webhook доходит со статусом 200",
    ),
    IntegrationSpec(
        key="npd_moy_nalog",
        title="НПД: «Мой налог» (OAuth) и статус плательщика НПД ФНС",
        production_policy="none",
        env_keys=(
            "MOY_NALOG_ENABLED",
            "MOY_NALOG_CLIENT_ID",
            "MOY_NALOG_CLIENT_SECRET",
            "MOY_NALOG_REDIRECT_URI",
            "MOY_NALOG_TOKEN_URL",
            "MOY_NALOG_TOKEN_ENCRYPTION_KEYS",
        ),
        real=(
            KeyedProvider(
                "moy_nalog_oauth",
                lambda s: bool(s.moy_nalog_enabled),
                _moy_nalog_missing,
                lambda s: ("статус НПД ФНС (statusnpd.nalog.ru) публичный и ключей не требует",),
            ),
        ),
        stub=StubProvider(
            "stub",
            (
                "MOY_NALOG_ENABLED",
                "MOY_NALOG_CLIENT_ID",
                "MOY_NALOG_CLIENT_SECRET",
                "MOY_NALOG_TOKEN_URL",
                "MOY_NALOG_TOKEN_ENCRYPTION_KEYS",
            ),
            "привязка «Мой налог» отвечает 501; владение ИНН не подтверждается",
        ),
        manual_prerequisites=(
            "получить у ФНС реквизиты OAuth-клиента и подтвердить контракт обновления токена",
        ),
        smoke="admin status: configured; привязка проходит OAuth-колбэк на тестовом налогоплательщике",
    ),
    IntegrationSpec(
        key="fns_receipts",
        title="Проверка фискальных чеков ФНС",
        production_policy="none",
        env_keys=("FNS_RECEIPT_LOGIN", "FNS_RECEIPT_PASSWORD"),
        real=(
            KeyedProvider(
                "fns_receipts",
                lambda s: _set(s.fns_receipt_login) or _set(s.fns_receipt_password),
                _fns_receipts_missing,
            ),
        ),
        stub=StubProvider(
            "stub",
            ("FNS_RECEIPT_LOGIN", "FNS_RECEIPT_PASSWORD"),
            "чек не верифицируется у ФНС; проверка остаётся ручной",
        ),
        smoke="проверка реального чека через приложение возвращает статус от ФНС",
    ),
    IntegrationSpec(
        key="sms_otp",
        title="SMS / OTP: Twilio",
        production_policy="fail",
        critical=True,
        env_keys=("TWILIO_SID", "TWILIO_TOKEN", "TWILIO_FROM"),
        real=(
            KeyedProvider(
                "twilio",
                lambda s: _set(s.twilio_sid) or _set(s.twilio_token) or _set(s.twilio_from),
                _twilio_missing,
            ),
        ),
        stub=StubProvider(
            "stub",
            ("TWILIO_SID", "TWILIO_TOKEN", "TWILIO_FROM"),
            "в development SMS — только предпросмотр; в рабочих средах старт отклоняется",
        ),
        manual_prerequisites=("подтвердить доставку на российские номера и допустимость отправителя",),
        smoke="вход по SMS на реальный номер; код приходит и принимается",
    ),
    IntegrationSpec(
        key="push",
        title="Push: Expo Push → APNs / FCM",
        production_policy="none",
        env_keys=(),
        real=(),
        stub=ExternalOnlyProvider(
            "expo_push",
            "серверу ключи не нужны; APNs/FCM-ключи и projectId лежат в EAS/приложении и отсюда не проверяются",
        ),
        manual_prerequisites=(
            "iOS: APNs-ключ в EAS credentials для bundle id приложения",
            "Android: FCM-ключ сервис-аккаунта в EAS credentials",
            "RENOVA_EAS_PROJECT_ID задан при сборке (иначе нет Expo push token)",
        ),
        smoke="установить сборку, войти, получить push и квитанцию (push_receipt_worker)",
    ),
    IntegrationSpec(
        key="esign",
        title="Электронная подпись: Контур.Сайн (Госключ не реализован)",
        production_policy="none",
        env_keys=("KONTUR_MODE", "KONTUR_API_KEY", "KONTUR_API_URL", "ESIGN_WEBHOOK_SECRET"),
        real=(
            KeyedProvider(
                "kontur",
                lambda s: _kontur_mode(s) in {"sandbox", "live"},
                _kontur_missing,
                _kontur_notes,
            ),
        ),
        stub=StubProvider(
            "in_app",
            ("KONTUR_MODE", "KONTUR_API_KEY", "ESIGN_WEBHOOK_SECRET"),
            "работает внутренняя подпись (in_app); внешний провайдер не подключён",
        ),
        smoke="документ уходит на подпись в песочнице Контура, webhook возвращает статус",
    ),
    IntegrationSpec(
        key="storage",
        title="Хранилище файлов: S3 / MinIO",
        production_policy="fail",
        critical=True,
        env_keys=("S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "S3_PUBLIC_URL"),
        real=(KeyedProvider("s3", _s3_selected, _s3_missing),),
        stub=StubProvider(
            "local_disk",
            ("S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"),
            "файлы пишутся на диск контейнера (UPLOADS_DIR) и теряются при пересоздании",
        ),
        smoke="загрузка документа/фото в приложении; объект появляется в бакете; ссылка открывается",
    ),
    IntegrationSpec(
        key="email",
        title="Email: SMTP (аварийные оповещения и письма)",
        production_policy="none",
        env_keys=("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "OPS_ALERT_EMAIL"),
        real=(KeyedProvider("smtp", lambda s: _set(s.smtp_host), _smtp_missing),),
        stub=StubProvider(
            "log_only",
            ("SMTP_HOST", "SMTP_FROM"),
            "письма не отправляются, содержимое только пишется в лог",
        ),
        smoke="тестовое письмо OPS_ALERT_EMAIL (сценарий в docs/INTEGRATIONS.md)",
    ),
    IntegrationSpec(
        key="sentry",
        title="Ошибки: Sentry",
        production_policy="fail",
        critical=True,
        env_keys=("SENTRY_DSN",),
        real=(KeyedProvider("sentry", lambda s: _set(s.sentry_dsn), lambda s: ()),),
        stub=StubProvider("stub", ("SENTRY_DSN",), "ошибки никуда не отправляются"),
        smoke="тестовая ошибка появляется в проекте Sentry и доходит до дежурного",
    ),
    IntegrationSpec(
        key="otlp",
        title="Трассы и метрики: OTLP-коллектор",
        production_policy="fail",
        critical=True,
        env_keys=("OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_INSECURE"),
        real=(
            KeyedProvider("otlp", lambda s: _set(s.otel_exporter_otlp_endpoint), _otlp_missing),
        ),
        stub=StubProvider("stub", ("OTEL_EXPORTER_OTLP_ENDPOINT",), "телеметрия никуда не экспортируется"),
        smoke="в коллекторе видны трассы сервиса OTEL_SERVICE_NAME",
    ),
)

SPECS_BY_KEY: dict[str, IntegrationSpec] = {spec.key: spec for spec in SPECS}


@dataclass(frozen=True)
class IntegrationStatus:
    key: str
    title: str
    provider: str
    state: str
    missing_keys: tuple[str, ...]
    notes: tuple[str, ...]
    production_policy: str
    critical: bool
    manual_prerequisites: tuple[str, ...]
    smoke: str | None

    @property
    def configured(self) -> bool:
        return self.state == CONFIGURED

    @property
    def stub(self) -> bool:
        return self.state == STUB


def evaluate_one(spec: IntegrationSpec, s: Settings) -> IntegrationStatus:
    evaluation = spec.resolve(s).evaluate(s)
    return IntegrationStatus(
        key=spec.key,
        title=spec.title,
        provider=evaluation.provider,
        state=evaluation.state,
        missing_keys=evaluation.missing_keys,
        notes=evaluation.notes,
        production_policy=spec.production_policy,
        critical=spec.critical,
        manual_prerequisites=spec.manual_prerequisites,
        smoke=spec.smoke,
    )


def evaluate_all(s: Settings | None = None) -> list[IntegrationStatus]:
    current = s if s is not None else _default_settings()
    return [evaluate_one(spec, current) for spec in SPECS]


# --- last_check: процессная память, наружу — только время и итог конфигурационной проверки ----
_LAST_CHECK: dict[str, dict] = {}


def record_check(statuses: list[IntegrationStatus]) -> dict[str, dict]:
    """Сохранить итог проверки; вернуть предыдущий last_check по каждому ключу."""
    previous = {k: dict(v) for k, v in _LAST_CHECK.items()}
    now = datetime.now(timezone.utc).isoformat()
    for st in statuses:
        _LAST_CHECK[st.key] = {"at": now, "ok": st.configured, "kind": "configuration"}
    return previous


def status_report(s: Settings | None = None) -> dict:
    """Структура ответа ``GET /admin/integrations/status`` (без значений секретов)."""
    current = s if s is not None else _default_settings()
    statuses = evaluate_all(current)
    previous = record_check(statuses)
    items = []
    for st in statuses:
        items.append(
            {
                "key": st.key,
                "title": st.title,
                "provider": st.provider,
                "state": st.state,
                "configured": st.configured,
                "stub": st.stub,
                "missing_keys": list(st.missing_keys),
                "notes": list(st.notes),
                "production_policy": st.production_policy,
                "critical": st.critical,
                "manual_prerequisites": list(st.manual_prerequisites),
                "smoke": st.smoke,
                "live_verified": False,
                "last_check": _LAST_CHECK[st.key],
                "previous_check": previous.get(st.key),
            }
        )
    return {
        "environment": current.normalized_environment,
        "verification": "configuration_only",
        "summary": {
            "total": len(items),
            "configured": sum(1 for i in items if i["configured"]),
            "stub": sum(1 for i in items if i["stub"]),
            "partial": sum(1 for i in items if i["state"] == PARTIAL),
            "external_only": sum(1 for i in items if i["state"] == EXTERNAL_ONLY),
        },
        "integrations": items,
    }


def _default_settings() -> Settings:
    from app.core.config import settings

    return settings


# --- production fail-closed ------------------------------------------------------
def policy_findings(s: Settings) -> tuple[list[str], list[str]]:
    """(errors, warnings) для staging/production. В development/test — пусто."""
    environment = s.normalized_environment
    if environment not in WORKING_ENVIRONMENTS:
        return [], []
    errors: list[str] = []
    warnings: list[str] = []
    for spec in SPECS:
        st = evaluate_one(spec, s)
        if st.configured or st.state == EXTERNAL_ONLY:
            continue
        what = f"{environment}: интеграция «{spec.key}» ({st.state}): " + (
            "не хватает " + ", ".join(st.missing_keys) if st.missing_keys else "не настроена"
        )
        fails = environment == "production" and (
            spec.production_policy == "fail" or (s.integrations_strict and spec.critical)
        )
        if fails:
            errors.append(what)
        elif spec.key == "storage" or st.state == PARTIAL:
            # остальные пробелы (платежи, SMS, Sentry, OTLP) уже озвучены своими guard-ами
            warnings.append(what)
    return errors, warnings


def forwarded_allow_ips_findings(s: Settings) -> tuple[list[str], list[str]]:
    """C11: без доверенных прокси client.host — адрес балансировщика."""
    environment = s.normalized_environment
    if environment not in WORKING_ENVIRONMENTS:
        return [], []
    raw = (s.forwarded_allow_ips or os.environ.get("FORWARDED_ALLOW_IPS") or "").strip()
    errors: list[str] = []
    warnings: list[str] = []
    if not raw:
        message = (
            f"{environment}: FORWARDED_ALLOW_IPS не задан — за балансировщиком client.host станет его адресом "
            "(ломаются rate limit и IP-allowlist вебхука ЮKassa); укажите адреса прокси "
            "или 127.0.0.1, если прокси нет"
        )
        (errors if environment == "production" else warnings).append(message)
    elif "*" in raw:
        warnings.append(
            f"{environment}: FORWARDED_ALLOW_IPS=* доверяет X-Forwarded-For любому источнику — "
            "перечислите адреса балансировщика"
        )
    return errors, warnings


def cors_findings(s: Settings) -> list[str]:
    """C10: «*» в CORS запрещён в staging/production."""
    if s.normalized_environment not in WORKING_ENVIRONMENTS:
        return []
    origins = [o.strip() for o in (s.cors_allowed_origins or "").split(",") if o.strip()]
    if any("*" in origin for origin in origins):
        return [f"{s.normalized_environment}: CORS_ALLOWED_ORIGINS не может содержать «*» — перечислите origin-ы"]
    return []


def validate_integration_policy(s: Settings) -> None:
    """Fail-closed для production/staging; вызывается из ``validate_configured_runtime``."""
    errors, _ = policy_findings(s)
    f_errors, _ = forwarded_allow_ips_findings(s)
    errors.extend(f_errors)
    errors.extend(cors_findings(s))
    if errors:
        raise ValueError("Integration guard failed:\n- " + "\n- ".join(errors))


def integration_warnings(s: Settings) -> tuple[str, ...]:
    _, warnings = policy_findings(s)
    _, f_warnings = forwarded_allow_ips_findings(s)
    return tuple(warnings + f_warnings)
