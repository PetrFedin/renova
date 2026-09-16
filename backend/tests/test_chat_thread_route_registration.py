"""P0 #316: runtime must expose exactly one canonical ChatThread create route."""

from app.api.v1.router import api_router


def test_chat_thread_create_has_single_integrity_handler():
    path = "/api/v1/projects/{project_id}/chats"
    routes = [
        route
        for route in api_router.routes
        if getattr(route, "path", None) == path
        and "POST" in set(getattr(route, "methods", set()) or set())
    ]
    assert len(routes) == 1, [getattr(route, "name", None) for route in routes]
    assert getattr(routes[0], "endpoint", None).__module__.endswith("chat_thread_creation_integrity")
