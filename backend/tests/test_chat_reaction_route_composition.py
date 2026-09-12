"""#384: router exposes exactly one canonical replay-safe reaction writer."""
from app.main import app


def test_one_replay_safe_chat_reaction_route_is_composed():
    target = "/api/v1/projects/{project_id}/chats/{thread_id}/messages/{message_id}/react"
    matches = [
        route
        for route in app.routes
        if getattr(route, "path", None) == target
        and "POST" in (getattr(route, "methods", set()) or set())
    ]
    assert len(matches) == 1
    endpoint = matches[0].endpoint
    assert endpoint.__module__ == "app.api.v1.chat_reaction_intents"
    assert endpoint.__name__ == "react_message"
