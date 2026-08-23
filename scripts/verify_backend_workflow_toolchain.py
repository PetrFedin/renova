#!/usr/bin/env python3
"""Fail when backend workflows drift from Renova's locked Python/Poetry contract."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
CANONICAL_ACTION = "uses: ./.github/actions/setup-backend"
EXACT_PYTHON = 'python-version: "3.12.13"'
EXACT_POETRY = "poetry==2.4.1"

# Broad/specialized workflows can legitimately own more setup (container image,
# security audit, EAS/mobile build, external staging or load tooling). They still
# may not use floating Python/Poetry or bypass the lock with ad-hoc installs.
SPECIALIZED_WORKFLOWS = {
    "backend-dependency-integrity.yml",
    "backend-image.yml",
    "ci.yml",
    "eas-build.yml",
    "external-staging-release.yml",
    "load-slo-integrity.yml",
    "security-operations.yml",
    "staging-runtime-smoke.yml",
}

FLOATING_PYTHON = re.compile(r"python-version:\s*['\"]?3\.12['\"]?\s*$", re.MULTILINE)


def _is_backend_workflow(text: str) -> bool:
    return (
        "working-directory: backend" in text
        or "cd backend" in text
        or "poetry run pytest" in text
        or "backend/tests/" in text
        or "python -m alembic" in text
    )


def _poetry_install_lines(text: str) -> list[str]:
    return [
        line.strip()
        for line in text.splitlines()
        if "pip install" in line and "poetry" in line
    ]


def _manual_exact_contract(text: str) -> bool:
    return (
        EXACT_PYTHON in text
        and any(EXACT_POETRY in line for line in _poetry_install_lines(text))
        and "poetry check --lock" in text
        and "poetry sync --no-interaction" in text
        and "poetry run python -m pip check" in text
    )


def _problems(path: Path, text: str) -> list[str]:
    if not _is_backend_workflow(text):
        return []

    problems: list[str] = []
    if FLOATING_PYTHON.search(text):
        problems.append("floating Python 3.12; use exact 3.12.13/canonical setup")

    poetry_lines = _poetry_install_lines(text)
    if any(EXACT_POETRY not in line for line in poetry_lines):
        problems.append("unversioned Poetry install")
    if "poetry install --no-interaction" in text:
        problems.append("poetry install bypasses canonical poetry sync contract")
    if "poetry run pip install" in text or "poetry run python -m pip install" in text:
        problems.append("ad-hoc package install after lock sync")

    if path.name not in SPECIALIZED_WORKFLOWS:
        if CANONICAL_ACTION not in text and not _manual_exact_contract(text):
            problems.append(
                "focused backend workflow lacks canonical composite or equivalent exact locked setup"
            )
    return problems


def main() -> int:
    failures: list[tuple[str, list[str]]] = []
    checked = 0
    composite = 0
    manual_exact = 0
    specialized = 0

    for path in sorted(WORKFLOWS.glob("*.yml")):
        text = path.read_text(encoding="utf-8")
        if not _is_backend_workflow(text):
            continue
        checked += 1
        if CANONICAL_ACTION in text:
            composite += 1
        elif _manual_exact_contract(text):
            manual_exact += 1
        if path.name in SPECIALIZED_WORKFLOWS:
            specialized += 1
        problems = _problems(path, text)
        if problems:
            failures.append((path.name, problems))

    print(
        "Backend workflow toolchain inventory: "
        f"checked={checked} composite={composite} manual_exact={manual_exact} specialized={specialized}"
    )
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
