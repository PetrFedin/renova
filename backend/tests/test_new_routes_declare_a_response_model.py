"""A new endpoint must declare what it returns.

Without `response_model` FastAPI serialises whatever the handler hands back.
Today that is nearly always an explicitly built dict — no handler in
app/api/v1 returns an ORM instance, so this is not a data-leak problem — but
it does mean the response has no declared contract:

  - the OpenAPI schema for the route is empty, so nothing generated from it
    describes the payload;
  - a service's `*_dict()` helper gaining a key silently changes the API, and
    no test or reviewer sees it as an API change.

45 of 386 routes declare one. Converting the other 341 is not a safe bulk
edit: `response_model` *filters* the response, so every field the model omits
disappears, and the mobile client would fail silently on whichever ones were
missed. Each conversion needs its own before/after comparison.

So this is a ratchet rather than a sweep, in the same shape as the npm-audit
and mobile-typecheck baselines: the routes that lack a model today are
recorded, and any route that is not on that list must declare one. The cost
lands where it is lowest — on endpoints being written now — and the list can
only shrink.

Regenerate after typing a route, or after deleting one:

    python -m tests.test_new_routes_declare_a_response_model --update
"""

from __future__ import annotations

import json
import pathlib

from fastapi.routing import iter_route_contexts

from app.api.v1.router import api_router

BASELINE = pathlib.Path(__file__).parent / "data" / "untyped_routes_baseline.json"
REGENERATE = "python -m tests.test_new_routes_declare_a_response_model --update"


def _routes() -> list[tuple[str, bool]]:
    """Every (signature, has_response_model) in the runtime table."""
    out = []
    for route in iter_route_contexts(api_router.routes):
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", set()) or set()
        if not path or not methods:
            continue
        typed = getattr(route, "response_model", None) is not None
        for method in methods:
            out.append((f"{method} {path}", typed))
    return out


def _untyped() -> set[str]:
    return {signature for signature, typed in _routes() if not typed}


def _typed() -> set[str]:
    return {signature for signature, typed in _routes() if typed}


def _baseline() -> set[str]:
    return set(json.loads(BASELINE.read_text()))


def test_the_baseline_matches_the_route_table():
    """Guards the guard: a baseline of stale strings would assert nothing."""
    baseline = _baseline()
    assert baseline, "the baseline is empty; that would let any route through"

    known = {signature for signature, _ in _routes()}
    vanished = sorted(baseline - known)
    # Deleted or renamed routes are not a failure — they are the point — but a
    # baseline that has drifted far from the table is no longer describing it.
    assert len(vanished) < len(baseline) // 2, (
        f"{len(vanished)} of {len(baseline)} baseline entries no longer exist; "
        f"the list has drifted. Regenerate with:\n    {REGENERATE}"
    )


def test_no_new_route_may_omit_its_response_model():
    added = sorted(_untyped() - _baseline())

    assert not added, (
        "these routes declare no response_model and are not in the baseline.\n"
        "Add `response_model=` to each, or — if the payload genuinely has no\n"
        "stable shape — record the exception with:\n"
        f"    {REGENERATE}\n\n" + "\n".join(f"  {signature}" for signature in added)
    )


def test_the_baseline_may_only_shrink():
    """A route that has since been typed must leave the list."""
    resolved = sorted(_baseline() & _typed())

    assert not resolved, (
        f"{len(resolved)} route(s) now declare a response_model but are still\n"
        f"listed as exceptions. Regenerate with:\n    {REGENERATE}\n\n"
        + "\n".join(f"  {signature}" for signature in resolved)
    )


if __name__ == "__main__":  # pragma: no cover - maintenance entry point
    import sys

    if "--update" not in sys.argv:
        print(f"usage: {REGENERATE}")
        raise SystemExit(2)

    before = _baseline() if BASELINE.exists() else set()
    current = _untyped()
    BASELINE.write_text(json.dumps(sorted(current), indent=2, ensure_ascii=False) + "\n")
    print(f"baseline: {len(before)} -> {len(current)} untyped routes")
    for gone in sorted(before - current):
        print(f"  resolved or removed: {gone}")
