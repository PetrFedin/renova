#!/usr/bin/env python3
"""Fail when focused backend workflows drift from the canonical locked setup."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
CANONICAL_ACTION = "uses: ./.github/actions/setup-backend"

# These broad/specialized workflows have deliberately different setup semantics
# (container build, security audit, external staging, or the main CI itself).
# They must still avoid the legacy floating patterns below, but are not required
# to invoke the focused-test composite action.
MANUAL_LOCKED_WORKFLOWS = {
    "backend-dependency-integrity.yml",
    "backend-image.yml",
    "ci.yml",
    "external-staging-release.yml",
    "security-operations.yml",
    "staging-runtime-smoke.yml",
}

FLOATING_PYTHON = re.compile(r"python-version:\s*['\"]?3\.12['\"]?\s*$", re.MULTILINE)
UNPINNED_POETRY = re.compile(
    r"(?:^|\s)(?:python\s+-m\s+)?pip\s+install(?:\s+--[^\n]+?)*\s+poetry(?:\s|$)",
    re.MULTILINE,
)


def _is_backend_workflow(text: str) -> bool:
    return (
        "working-directory: backend" in text
        or "cd backend" in text
        or "poetry run pytest" in text
        or "backend/tests/" in text
        or "python -m alembic" in text
    )


def _problems(path: Path, text: str) -> list[str]:
    if not _is_backend_workflow(text):
        return []

    problems: list[str] = []
    if FLOATING_PYTHON.search(text):
        problems.append("floating Python 3.12; use exact 3.12.13/canonical setup")
    if UNPINNED_POETRY.search(text):
        problems.append("unversioned Poetry install")
    if "poetry install --no-interaction" in text:
        problems.append("poetry install bypasses canonical poetry sync contract")
    if "poetry run pip install" in text or "poetry run python -m pip install" in text:
        problems.append("ad-hoc package install after lock sync")

    if path.name not in MANUAL_LOCKED_WORKFLOWS and CANONICAL_ACTION not in text:
        problems.append("focused backend workflow does not use ./.github/actions/setup-backend")
    return problems


def main() -> int:
    failures: list[tuple[str, list[str]]] = []
    for path in sorted(WORKFLOWS.glob("*.yml")):
        text = path.read_text(encoding="utf-8")
        problems = _problems(path, text)
        if problems:
            failures.append((path.name, problems))

    if failures:
        print("Backend workflow toolchain drift detected:")
        for name, problems in failures:
            print(f"- {name}")
            for problem in problems:
                print(f"  - {problem}")
        return 1

    print("Backend workflow toolchain policy: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
