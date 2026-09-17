#!/usr/bin/env python3
"""Ratcheted ruff + mypy gate for the backend.

The backend had no linter, no formatter and no type checker: `grep -rn
'ruff|mypy|black|flake8' pyproject.toml backend/pyproject.toml package.json
.github/workflows/*.yml` returned nothing. The only static gate in the
repository was `tsc` for mobile.

Turning either tool on as a hard failure would mean either a large mechanical
diff across a 58k-line codebase, or switching almost every rule off. Both are
worse than a ratchet, so this follows the shape the repository already uses for
npm audit (`scripts/check-npm-audit-baseline.mjs`) and mobile typecheck
(`scripts/typecheck-mobile.sh`): the current findings are recorded per rule,
that record may only shrink, and anything new fails the build.

    python scripts/check_backend_lint_baseline.py            # enforce
    python scripts/check_backend_lint_baseline.py --update   # re-record

The baseline counts findings per rule code, not per line, so moving code around
does not produce noise while a genuinely new violation still fails.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPO_ROOT / "backend"
BASELINE_PATH = REPO_ROOT / "scripts" / "backend-lint-baseline.json"

RUFF_TARGET = "app"
MYPY_TARGET = "app/services"

_RUFF_LINE = re.compile(r"^(?P<path>[^:]+):\d+:\d+:\s+(?P<code>[A-Z]+\d+)\s")
_MYPY_LINE = re.compile(r"^(?P<path>[^:]+):\d+:(?:\d+:)?\s+error:.*\[(?P<code>[a-z-]+)\]\s*$")


def _run(command: list[str]) -> str:
    result = subprocess.run(
        command,
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout + result.stderr


def collect_ruff() -> Counter[str]:
    output = _run(["ruff", "check", "--output-format", "concise", RUFF_TARGET])
    counts: Counter[str] = Counter()
    for line in output.splitlines():
        match = _RUFF_LINE.match(line.strip())
        if match:
            counts[match.group("code")] += 1
    return counts


def collect_mypy() -> Counter[str]:
    output = _run(
        [
            "mypy",
            "--ignore-missing-imports",
            "--no-strict-optional",
            "--show-error-codes",
            "--no-error-summary",
            MYPY_TARGET,
        ]
    )
    counts: Counter[str] = Counter()
    for line in output.splitlines():
        match = _MYPY_LINE.match(line.strip())
        if match:
            counts[match.group("code")] += 1
    return counts


def _load_baseline() -> dict[str, dict[str, int]]:
    if not BASELINE_PATH.exists():
        return {"ruff": {}, "mypy": {}}
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8"))


def _compare(tool: str, current: Counter[str], recorded: dict[str, int]) -> list[str]:
    failures: list[str] = []
    improvements: list[str] = []

    for code, count in sorted(current.items()):
        allowed = recorded.get(code, 0)
        if count > allowed:
            failures.append(
                f"{tool}: {code} went from {allowed} to {count} — fix it or justify it"
            )
        elif count < allowed:
            improvements.append(f"{tool}: {code} improved {allowed} -> {count}")

    for code, allowed in sorted(recorded.items()):
        if code not in current and allowed:
            improvements.append(f"{tool}: {code} fully resolved ({allowed} -> 0)")

    for line in improvements:
        print(f"  {line} (run --update to lock it in)")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update", action="store_true", help="re-record the baseline")
    args = parser.parse_args()

    ruff = collect_ruff()
    mypy = collect_mypy()

    if args.update:
        BASELINE_PATH.write_text(
            json.dumps(
                {"ruff": dict(sorted(ruff.items())), "mypy": dict(sorted(mypy.items()))},
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"baseline written: ruff={sum(ruff.values())} mypy={sum(mypy.values())}")
        return 0

    baseline = _load_baseline()
    failures = _compare("ruff", ruff, baseline.get("ruff", {}))
    failures += _compare("mypy", mypy, baseline.get("mypy", {}))

    if failures:
        print()
        for failure in failures:
            print(f"  {failure}")
        return 1

    print(
        f"backend lint baseline OK (ruff={sum(ruff.values())} mypy={sum(mypy.values())})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
