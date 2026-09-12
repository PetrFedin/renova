"""#390: exactly one replay-safe production chat-thread writer is composed."""
from fastapi.routing import iter_route_contexts

from app.main import app


def test_one_replay_safe_chat_thread_create_route_is_composed():
    target = "/api/v1/projects/{project_id}/chats"
    matches = [
        route
        for route in iter_route_contexts(app.routes)
        if getattr(route, "path", None) == target
        and "POST" in (getattr(route, "methods", set()) or set())
    ]
    assert len(matches) == 1, (target, [(getattr(route, "path", None), getattr(route, "methods", None)) for route in matches])
    endpoint = matches[0].endpoint
    assert endpoint.__module__ == "app.api.v1.chat_thread_intents"
    assert endpoint.__name__ == "create_chat_thread"
