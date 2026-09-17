#!/usr/bin/env python3
"""Fail when a router persists a body-supplied child id without scoping it.

``require_project(db, project_id, user)`` authorises the project named in the
*path*. It proves nothing about a ``room_id``/``stage_id``/``payment_id`` that
arrives in the request *body*: a foreign key only guarantees the referenced row
exists, not that it belongs to this project. Without an explicit check a user
authorised on project A can bind a record to a row of project B.

The repository had no shared helper for this — 124 hand-rolled checks spread
across routers and services — which is why the backlog carries a recurring
stream of "[P0 Security] Bind <thing> to path project" issues.

Scope of this check is deliberately narrow so it does not cry wolf:

    A router must not write a body-supplied child id straight into an ORM
    model. Run it through ``app.api.scoping.scoped_id`` first.

It is an AST check, not a grep. Two shapes are reported:

    Model(..., room_id=body.room_id, ...)      # constructor keyword
    row.room_id = body.room_id                 # attribute assignment

Passing a body id on to a *service* is not reported: the service owns that
validation (``technical_supervision_action_service``, ``calendar_mutation_service``
and ``stage_mutation_service`` all do it) and no rule at this level can prove it
from the router. A grep-shaped version of this check was tried first and was
abandoned precisely because it could not tell those two cases apart — it both
missed the real selections.py defect and flagged three correct modules.

Usage:
    python scripts/check_project_scoped_references.py            # enforce
    python scripts/check_project_scoped_references.py --list     # current state
"""
from __future__ import annotations

import argparse
import ast
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ROUTER_DIR = REPO_ROOT / "backend" / "app" / "api" / "v1"

# Child references that are meaningful only inside one project.
SCOPED_FIELDS: frozenset[str] = frozenset(
    {
        "room_id",
        "stage_id",
        "floor_plan_id",
        "payment_id",
        "document_id",
        "thread_id",
        "issue_id",
        "acceptance_id",
        "order_id",
        "purchase_id",
        "schedule_id",
        "expense_id",
        "receipt_id",
        "pick_id",
        "line_id",
        "selection_id",
        "evidence_id",
        "package_id",
        "depends_on_stage_id",
    }
)

REQUEST_OBJECTS: frozenset[str] = frozenset(
    {"body", "payload", "data", "req", "request_body"}
)

SCOPING_CALLS: frozenset[str] = frozenset({"scoped", "scoped_id", "scoped_all"})


class _ScopedWriteVisitor(ast.NodeVisitor):
    def __init__(self, module: str) -> None:
        self.module = module
        self.findings: list[tuple[str, str, int]] = []
        self._scoped_names: set[str] = set()

    @staticmethod
    def _is_request_attribute(node: ast.AST) -> bool:
        """`body.room_id` and friends, at any depth of the expression."""
        for child in ast.walk(node):
            if (
                isinstance(child, ast.Attribute)
                and isinstance(child.value, ast.Name)
                and child.value.id in REQUEST_OBJECTS
            ):
                return True
        return False

    @staticmethod
    def _is_scoping_call(node: ast.AST) -> bool:
        for child in ast.walk(node):
            if not isinstance(child, ast.Call):
                continue
            func = child.func
            name: str | None = None
            if isinstance(func, ast.Name):
                name = func.id
            elif isinstance(func, ast.Attribute):
                name = func.attr
            if name in SCOPING_CALLS:
                return True
        return False

    def _value_is_safe(self, value: ast.AST) -> bool:
        if self._is_scoping_call(value):
            return True
        # `room_id = await scoped_id(...)` earlier in the handler, then
        # `Model(room_id=room_id)`.
        if isinstance(value, ast.Name) and value.id in self._scoped_names:
            return True
        return not self._is_request_attribute(value)

    def visit_Assign(self, node: ast.Assign) -> None:  # noqa: N802
        if self._is_scoping_call(node.value):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self._scoped_names.add(target.id)

        for target in node.targets:
            if (
                isinstance(target, ast.Attribute)
                and target.attr in SCOPED_FIELDS
                and not self._value_is_safe(node.value)
            ):
                self.findings.append((self.module, target.attr, node.lineno))
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:  # noqa: N802
        if node.value is not None and self._is_scoping_call(node.value):
            if isinstance(node.target, ast.Name):
                self._scoped_names.add(node.target.id)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        func = node.func
        # ORM model constructors are CapWords names: SelectionItem(...), Room(...)
        if isinstance(func, ast.Name) and func.id[:1].isupper():
            for keyword in node.keywords:
                if keyword.arg in SCOPED_FIELDS and not self._value_is_safe(
                    keyword.value
                ):
                    self.findings.append((self.module, keyword.arg, node.lineno))
        self.generic_visit(node)


def scan_source(source: str, module: str = "<memory>") -> list[tuple[str, str, int]]:
    visitor = _ScopedWriteVisitor(module)
    visitor.visit(ast.parse(source, filename=module))
    return sorted(set(visitor.findings))


def scan() -> list[tuple[str, str, int]]:
    findings: list[tuple[str, str, int]] = []
    for path in sorted(ROUTER_DIR.glob("*.py")):
        findings.extend(
            scan_source(path.read_text(encoding="utf-8"), module=path.name)
        )
    return sorted(set(findings))


# Unscoped writes that already existed when this check landed. This list may
# only shrink; each entry is a genuine gap, not an accepted design.
KNOWN_UNSCOPED: frozenset[tuple[str, str]] = frozenset()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true", help="print current findings")
    args = parser.parse_args()

    findings = scan()
    if args.list:
        for module, field, lineno in findings:
            print(f"{module}:{lineno}: {field}")
        print(f"total: {len(findings)}")
        return 0

    current = {(module, field) for module, field, _lineno in findings}
    new = current - KNOWN_UNSCOPED
    fixed = sorted(KNOWN_UNSCOPED - current)

    if fixed:
        print("Scope proofs added since the baseline (shrink KNOWN_UNSCOPED):")
        for module, field in fixed:
            print(f"  fixed: {module}: {field}")

    if new:
        print()
        print("A body-supplied child id is written to a model without proving it")
        print("belongs to the path project. Use app.api.scoping.scoped_id:")
        print()
        print("    room_id = await scoped_id(db, Room, body.room_id, project_id)")
        print()
        for module, field, lineno in findings:
            if (module, field) in new:
                print(f"  {module}:{lineno}: {field}")
        return 1

    print(f"project-scoped write check OK (known gaps: {len(current)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
