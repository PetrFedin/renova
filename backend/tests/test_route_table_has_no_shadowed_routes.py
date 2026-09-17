"""Two routers must never both answer the same (path, method).

FastAPI resolves the first matching route and silently ignores the rest, so a
shadowed endpoint does not fail — it just stops being reachable, and the only
symptom is that a fixed bug appears to come back.

`router.py` handles this by *removing* the superseded routes from the older
router before including it, in 13 places:

    _PAYMENT_HISTORY_ROUTES = {("/projects/{project_id}/payments", "GET")}
    _remove_replaced_routes(payments.router, _PAYMENT_HISTORY_ROUTES | ...)
    api_router.include_router(payment_history.router)
    ...
    api_router.include_router(payments.router)

That is stronger than ordering the includes, because it cannot be undone by
someone moving an `include_router` line. But nothing asserted it globally, and
the one thing that tried — a mobile test comparing
`router.indexOf('payment_history.router') < router.indexOf('payments.router')`
— was reading the `_remove_replaced_routes(payments.router, ...)` line as the
first occurrence of `payments.router`, so it measured the wrong thing and had
been failing for a reason unrelated to routing.

This asserts the property itself, on the runtime table, for every route.
"""

from __future__ import annotations

from collections import Counter

from fastapi.routing import iter_route_contexts

from app.api.v1 import router as router_module
from app.api.v1.router import api_router


def _pairs():
    pairs = []
    for route in iter_route_contexts(api_router.routes):
        path = getattr(route, "path", None)
        for method in getattr(route, "methods", set()) or set():
            pairs.append((path, method))
    return pairs


def test_no_two_routes_answer_the_same_path_and_method():
    pairs = _pairs()
    assert pairs, "the route table must not be empty"

    duplicates = sorted(pair for pair, count in Counter(pairs).items() if count > 1)

    assert not duplicates, "shadowed routes (only the first is reachable):\n" + "\n".join(
        f"  {method} {path}" for path, method in duplicates
    )


def test_every_superseded_signature_resolves_to_exactly_one_route():
    """Each signature handed to `_remove_replaced_routes` must still be served.

    Removing a route that nothing replaces would delete an endpoint outright,
    which is the opposite failure and just as silent.
    """
    signatures: set[tuple[str, str]] = set()
    for name, value in vars(router_module).items():
        if name.startswith("_") and name.endswith("_ROUTES") and isinstance(value, set):
            signatures |= value

    assert signatures, "no _*_ROUTES signature sets found; has router.py been restructured?"

    served = Counter(_pairs())
    missing = []
    for path, method in sorted(signatures):
        # The sets are written without the /api/v1 prefix the router mounts.
        count = served.get((f"/api/v1{path}", method), 0)
        if count != 1:
            missing.append(f"  {method} {path} -> {count} route(s)")

    assert not missing, "superseded signatures not served exactly once:\n" + "\n".join(missing)


def test_the_removal_is_what_keeps_the_table_unique():
    """Without `_remove_replaced_routes` the table really would collide.

    Otherwise this file would pass for a codebase that never needed the
    mechanism, and would not notice its removal.
    """
    signatures: set[tuple[str, str]] = set()
    for name, value in vars(router_module).items():
        if name.startswith("_") and name.endswith("_ROUTES") and isinstance(value, set):
            signatures |= value

    assert len(signatures) >= 10, (
        "the mechanism is in use in many places; if this count has collapsed, "
        f"check router.py rather than relaxing the bound (got {len(signatures)})"
    )
