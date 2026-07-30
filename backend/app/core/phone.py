"""Canonical phone identity for authentication and external delivery."""
from __future__ import annotations


class InvalidPhoneNumber(ValueError):
    pass


def normalize_phone(value: str) -> str:
    """Return one E.164-style identity and reject ambiguous input.

    Renova's primary market is Russia, so ten local digits and eleven digits
    beginning with 7/8 are normalized to +7. International numbers must be
    supplied with an explicit leading plus.
    """
    raw = (value or "").strip()
    if not raw or len(raw) > 32 or any(char in raw for char in "\r\n\x00"):
        raise InvalidPhoneNumber("invalid_phone")

    allowed_separators = {" ", "-", "(", ")"}
    for index, char in enumerate(raw):
        if char.isdigit() or char in allowed_separators:
            continue
        if char == "+" and index == 0:
            continue
        raise InvalidPhoneNumber("invalid_phone")

    digits = "".join(char for char in raw if char.isdigit())
    if raw.startswith("+"):
        if not 8 <= len(digits) <= 15:
            raise InvalidPhoneNumber("invalid_phone")
        return f"+{digits}"

    if len(digits) == 10:
        return f"+7{digits}"
    if len(digits) == 11 and digits[0] in {"7", "8"}:
        return f"+7{digits[-10:]}"
    raise InvalidPhoneNumber("invalid_phone")
