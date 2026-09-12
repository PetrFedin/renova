"""#398: exactly one replay-safe production stage-comment writer is composed."""
from fastapi.routing import iter_route_contexts

from app.main import app


def test_one_replay_safe_stage_comment_create_route_is_composed():
    target = "/api/v1/projects/{project_id}/stages/{stage_id}/comments"
    matches = [
        route
        for route in iter_route_contexts(app.routes)
        if getattr(route, "path", None) == target
        and "POST" in (getattr(route, "methods", set()) or set())
    ]
    assert len(matches) == 1, (target, [(getattr(route, "path", None), getattr(route, "methods", None)) for route in matches])
    endpoint = matches[0].endpoint
    assert endpoint.__module__ == "app.api.v1.stage_comment_intents"
    assert endpoint.__name__ == "add_comment"
