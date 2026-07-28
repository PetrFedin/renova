"""Sentry before_send sanitization — never ship secrets / PII payloads.

Strips authorization headers, tokens, passwords, payment requisites,
document contents, personal messages, and file bodies from events.
"""
from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEY_RE = re.compile(
    r"(authorization|access[_-]?token|refresh[_-]?token|password|secret|"
    r"api[_-]?key|private[_-]?key|cookie|set-cookie|yookassa|payment[_-]?requisite|"
    r"card[_-]?number|cvv|document[_-]?content|file[_-]?body|message[_-]?body|"
    r"personal[_-]?message|bearer)",
    re.I,
)

VALUE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-+=/]+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(password\s*[=:]\s*)\S+"), r"\1[REDACTED]"),
    (re.compile(r"(?i)(api[_-]?key\s*[=:]\s*)\S+"), r"\1[REDACTED]"),
]


def _redact_string(value: str) -> str:
    out = value
    for pat, repl in VALUE_PATTERNS:
        out = pat.sub(repl, out)
    return out


def redact_mapping(data: Any, *, depth: int = 0) -> Any:
    """Recursively redact sensitive keys/values. Caps depth to avoid cycles."""
    if depth > 8:
        return "[REDACTED_DEPTH]"
    if isinstance(data, dict):
        clean: dict[str, Any] = {}
        for key, val in data.items():
            ks = str(key)
            if SENSITIVE_KEY_RE.search(ks):
                clean[ks] = "[REDACTED]"
            else:
                clean[ks] = redact_mapping(val, depth=depth + 1)
        return clean
    if isinstance(data, list):
        return [redact_mapping(v, depth=depth + 1) for v in data[:50]]
    if isinstance(data, str):
        if len(data) > 2048:
            return "[REDACTED_LARGE_BODY]"
        return _redact_string(data)
    return data


def sentry_before_send(
    event: dict[str, Any], _hint: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """Sentry SDK before_send hook."""
    if not event:
        return event
    for section in ("request", "extra", "contexts", "user", "tags"):
        if section in event and event[section] is not None:
            event[section] = redact_mapping(event[section])
    req = event.get("request")
    if isinstance(req, dict):
        headers = req.get("headers")
        if isinstance(headers, dict):
            req["headers"] = {
                k: ("[REDACTED]" if SENSITIVE_KEY_RE.search(str(k)) else v)
                for k, v in headers.items()
            }
        if "data" in req:
            req["data"] = redact_mapping(req.get("data"))
        if "cookies" in req:
            req["cookies"] = "[REDACTED]"
        event["request"] = req
    crumbs = event.get("breadcrumbs")
    if isinstance(crumbs, dict) and isinstance(crumbs.get("values"), list):
        for crumb in crumbs["values"]:
            if isinstance(crumb, dict):
                if "data" in crumb:
                    crumb["data"] = redact_mapping(crumb["data"])
                msg = crumb.get("message")
                if isinstance(msg, str) and len(msg) > 512:
                    crumb["message"] = "[REDACTED_LARGE_BODY]"
    return event
