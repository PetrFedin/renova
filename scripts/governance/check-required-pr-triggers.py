#!/usr/bin/env python3
"""Fail closed when globally-required PR checks can stop being scheduled."""

from __future__ import annotations

import re
import sys
from pathlib import Path

TARGETS = {
    Path(".github/workflows/local-runtime-integrity.yml"): "source-and-runtime",
    Path(".github/workflows/mobile-typecheck-fail-closed-integrity.yml"): "typecheck-integrity",
    Path(".github/workflows/production-readiness-integrity.yml"): "snapshot",
}

_TRIGGER_RE = re.compile(r"^  pull_request:\s*(.*)$")
_EVENT_RE = re.compile(r"^  [A-Za-z0-9_-]+:\s*(?:\{.*\})?\s*$")
_PATH_FILTER_RE = re.compile(r"^    (paths|paths-ignore):\s*(?:\[.*\])?\s*$")
_INLINE_PATH_FILTER_RE = re.compile(r"\b(paths|paths-ignore)\s*:")


def _pull_request_block(text: str) -> tuple[str, list[str]]:
    lines = text.splitlines()
    start = None
    trigger_line = ""
    for index, line in enumerate(lines):
        if _TRIGGER_RE.match(line):
            start = index
            trigger_line = line
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
    return trigger_line, block


def _check_text(text: str, context: str) -> str | None:
    try:
        trigger_line, block = _pull_request_block(text)
    except ValueError as exc:
        return str(exc)

    inline = _INLINE_PATH_FILTER_RE.search(trigger_line.split("pull_request:", 1)[1])
    if inline:
        return f"pull_request trigger is filtered by {inline.group(1)}"

    for line in block:
        match = _PATH_FILTER_RE.match(line)
        if match:
            return f"pull_request trigger is filtered by {match.group(1)}"

    if not re.search(rf"^  {re.escape(context)}:\s*$", text, re.MULTILINE):
        return f"missing required job context {context}"
    return None


def _self_test() -> None:
    fixtures = {
        "unconditional": (
            "on:\n  pull_request:\njobs:\n  gate:\n    runs-on: ubuntu-latest\n",
            "gate",
            None,
        ),
        "types-only": (
            "on:\n  pull_request:\n    types: [opened, synchronize]\njobs:\n  gate:\n    runs-on: ubuntu-latest\n",
            "gate",
            None,
        ),
        "paths": (
            "on:\n  pull_request:\n    paths:\n      - 'backend/**'\njobs:\n  gate:\n    runs-on: ubuntu-latest\n",
            "gate",
            "pull_request trigger is filtered by paths",
        ),
        "paths-ignore": (
            "on:\n  pull_request:\n    paths-ignore:\n      - 'docs/**'\njobs:\n  gate:\n    runs-on: ubuntu-latest\n",
            "gate",
            "pull_request trigger is filtered by paths-ignore",
        ),
        "inline-paths": (
            "on:\n  pull_request: { paths: ['backend/**'] }\njobs:\n  gate:\n    runs-on: ubuntu-latest\n",
            "gate",
            "pull_request trigger is filtered by paths",
        ),
        "missing-trigger": (
            "on:\n  push:\n    branches: [main]\njobs:\n  gate:\n    runs-on: ubuntu-latest\n",
            "gate",
            "missing pull_request trigger",
        ),
        "missing-context": (
            "on:\n  pull_request:\njobs:\n  other:\n    runs-on: ubuntu-latest\n",
            "gate",
            "missing required job context gate",
        ),
    }
    for name, (text, context, expected) in fixtures.items():
        actual = _check_text(text, context)
        if actual != expected:
            raise AssertionError(f"self-test {name}: expected {expected!r}, got {actual!r}")


def main() -> int:
    _self_test()
    failures: list[str] = []
    for path, context in TARGETS.items():
        if not path.is_file():
            failures.append(f"{context}: missing workflow {path}")
            continue
        error = _check_text(path.read_text(encoding="utf-8"), context)
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
