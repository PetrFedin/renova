#!/usr/bin/env python3
"""Fail closed when globally-required PR checks become path-filtered.

The live main-protection ruleset requires these contexts on every pull request.
A workflow-level pull_request paths/paths-ignore filter can therefore deadlock a
perfectly valid PR by preventing GitHub from creating the required check-run.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TARGETS = {
    Path(".github/workflows/local-runtime-integrity.yml"): "source-and-runtime",
    Path(".github/workflows/mobile-typecheck-fail-closed-integrity.yml"): "typecheck-integrity",
    Path(".github/workflows/production-readiness-integrity.yml"): "snapshot",
}

_EVENT_RE = re.compile(r"^  [A-Za-z0-9_-]+:\s*(?:\{.*\})?\s*$")
_PATH_FILTER_RE = re.compile(r"^    (paths|paths-ignore):\s*(?:\[.*\])?\s*$")


def _pull_request_block(text: str) -> list[str]:
    lines = text.splitlines()
    start = None
    for index, line in enumerate(lines):
        if re.match(r"^  pull_request:\s*(?:\{.*\})?\s*$", line):
            start = index
            if "paths" in line:
                return [line]
            break
    if start is None:
        raise ValueError("missing pull_request trigger")

    block: list[str] = []
    for line in lines[start + 1 :]:
        if line and not line.startswith(" "):
            break
        if _EVENT_RE.match(line):
            break
        block.append(line)
    return block


def _check_text(text: str) -> str | None:
    try:
        block = _pull_request_block(text)
    except ValueError as exc:
        return str(exc)

    for line in block:
        if _PATH_FILTER_RE.match(line):
            return f"pull_request trigger is filtered by {line.strip().split(':', 1)[0]}"
    return None


def _self_test() -> None:
    fixtures = {
        "unconditional": ("on:\n  pull_request:\n  push:\n    branches: [main]\n", None),
        "types-only": ("on:\n  pull_request:\n    types: [opened, synchronize]\n", None),
        "paths": (
            "on:\n  pull_request:\n    paths:\n      - 'backend/**'\n",
            "pull_request trigger is filtered by paths",
        ),
        "paths-ignore": (
            "on:\n  pull_request:\n    paths-ignore:\n      - 'docs/**'\n",
            "pull_request trigger is filtered by paths-ignore",
        ),
        "missing": ("on:\n  push:\n    branches: [main]\n", "missing pull_request trigger"),
    }
    for name, (text, expected) in fixtures.items():
        actual = _check_text(text)
        if actual != expected:
            raise AssertionError(f"self-test {name}: expected {expected!r}, got {actual!r}")


def main() -> int:
    _self_test()
    failures: list[str] = []
    for path, context in TARGETS.items():
        if not path.is_file():
            failures.append(f"{context}: missing workflow {path}")
            continue
        error = _check_text(path.read_text(encoding="utf-8"))
        if error:
            failures.append(f"{context}: {error} ({path})")
        else:
            print(f"required PR trigger OK: {context} <- {path}")

    if failures:
        for failure in failures:
            print(f"ERROR: {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
