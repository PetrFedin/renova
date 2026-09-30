"""Guard: naive DateTime columns must never receive tz-aware datetimes.

Convention: every model column is ``DateTime`` (timezone-naive, UTC) and code
writes ``app.core.timeutil.utc_now()``. Writing ``datetime.now(timezone.utc)``
into such a column mixes naive/aware values and breaks comparisons
(``TypeError: can't compare offset-naive and offset-aware datetimes``).
"""
from __future__ import annotations

import ast
from pathlib import Path

from sqlalchemy import DateTime

import app.models.entities  # noqa: F401  (registers all models)
from app.db.base import Base

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def _naive_column_names() -> set[str]:
    names: set[str] = set()
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, DateTime) and not col.type.timezone:
                names.add(col.name)
    return names


def test_models_have_no_timezone_aware_datetime_columns():
    aware = [
        f"{t.name}.{c.name}"
        for t in Base.metadata.tables.values()
        for c in t.columns
        if isinstance(c.type, DateTime) and c.type.timezone
    ]
    assert not aware, f"model convention is naive UTC DateTime; aware columns: {aware}"


def _has_aware_now(node: ast.AST) -> bool:
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute):
            if sub.func.attr == "now" and (sub.args or sub.keywords):
                return True  # datetime.now(<tz>) is aware
    return False


def test_no_aware_datetime_written_to_naive_columns():
    naive = _naive_column_names()
    assert "due_at" in naive and "closed_at" in naive
    offenders: list[str] = []
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            targets: list[tuple[str, ast.AST]] = []
            if isinstance(node, ast.Call):
                targets = [(k.arg, k.value) for k in node.keywords if k.arg]
            elif isinstance(node, ast.Assign):
                targets = [(t.attr, node.value) for t in node.targets if isinstance(t, ast.Attribute)]
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Attribute):
                targets = [(node.target.attr, node.value)] if node.value else []
            for name, value in targets:
                if name in naive and _has_aware_now(value):
                    offenders.append(f"{path.relative_to(APP_DIR.parent)}:{node.lineno} {name}")
    assert not offenders, f"use utc_now() for naive columns: {offenders}"
