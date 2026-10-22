#!/usr/bin/env python3
"""Validate Renova cross-client continuation protocol using stdlib only."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CURSOR = ROOT / ".agent" / "CONTINUATION-CURSOR.md"
ROUTER = ROOT / ".agent" / "skills" / "renova-product-engineering" / "SKILL.md"
KICKOFF = ROOT / ".agent" / "kickoff.md"
ADAPTERS = {
    "claude": ROOT / ".agent" / "platforms" / "claude.md",
    "cursor": ROOT / ".agent" / "platforms" / "cursor.md",
    "codex": ROOT / ".agent" / "platforms" / "codex.md",
    "gpt": ROOT / ".agent" / "platforms" / "gpt.md",
}

REQUIRED_CURSOR_TOKENS = (
    "AGENT-CONTINUATION-CURSOR:v1",
    "head_sha",
    "last_completed",
    "next_action",
    "do_not_repeat",
    "must_not_skip",
    "checks_observed",
    "blockers",
    "durable checkpoint",
    "remote head",
)
REQUIRED_FLOW_TOKENS = (
    ".agent/CONTINUATION-CURSOR.md",
    "AGENT-CONTINUATION-CURSOR:v1",
    "next_action",
    "do_not_repeat",
    "must_not_skip",
)


def read(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError(path.relative_to(ROOT))
    return path.read_text(encoding="utf-8")


def main() -> int:
    failures: list[str] = []
    passed = 0

    def check(condition: bool, message: str) -> None:
        nonlocal passed
        if condition:
            passed += 1
        else:
            failures.append(message)

    try:
        cursor = read(CURSOR)
    except FileNotFoundError as exc:
        failures.append(f"missing {exc}")
        cursor = ""

    for token in REQUIRED_CURSOR_TOKENS:
        check(token.lower() in cursor.lower(), f"continuation cursor missing token: {token}")

    for label, path in (("router", ROUTER), ("kickoff", KICKOFF)):
        try:
            text = read(path)
        except FileNotFoundError as exc:
            failures.append(f"missing {exc}")
            continue
        for token in REQUIRED_FLOW_TOKENS:
            check(token.lower() in text.lower(), f"{label} missing continuation token: {token}")
        check("uncommitted" in text.lower(), f"{label} must define uncommitted-state boundary")
        check("remote" in text.lower() and "head" in text.lower(), f"{label} must validate remote head")

    for name, path in ADAPTERS.items():
        try:
            text = read(path)
        except FileNotFoundError as exc:
            failures.append(f"missing {exc}")
            continue
        for token in REQUIRED_FLOW_TOKENS:
            check(token.lower() in text.lower(), f"{name} adapter missing continuation token: {token}")
        check("remote" in text.lower() and "head" in text.lower(), f"{name} adapter must refresh remote head")
        check("uncommitted" in text.lower(), f"{name} adapter must reject unshared uncommitted handoff")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        print(f"Agent continuation validation: {passed} passed, {len(failures)} failed")
        return 1

    print(f"Agent continuation validation: {passed} passed, 0 failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
