from __future__ import annotations

import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _jose_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    violations: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "jose" or alias.name.startswith("jose."):
                    violations.append(f"{path.relative_to(BACKEND_ROOT)}:{node.lineno}: import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module == "jose" or module.startswith("jose."):
                violations.append(f"{path.relative_to(BACKEND_ROOT)}:{node.lineno}: from {module} import ...")
    return violations


def test_python_jose_is_absent_from_backend_source_and_lock():
    violations: list[str] = []
    for root in (BACKEND_ROOT / "app", BACKEND_ROOT / "tests"):
        for path in root.rglob("*.py"):
            violations.extend(_jose_imports(path))

    pyproject = (BACKEND_ROOT / "pyproject.toml").read_text(encoding="utf-8").lower()
    lock = (BACKEND_ROOT / "poetry.lock").read_text(encoding="utf-8").lower()

    assert "python-jose" not in pyproject
    assert 'name = "python-jose"' not in lock
    assert violations == [], "python-jose imports remain:\n" + "\n".join(violations)
