from __future__ import annotations

from collections import Counter
import re

from fastapi.routing import APIRoute

from app.main import app


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
PATH_PARAMETER_PATTERN = re.compile(r"\{([^{}]+)\}")
FRAMEWORK_SURFACE_PATHS = {
    "/openapi.json",
    "/docs",
    "/docs/oauth2-redirect",
    "/redoc",
}


def _api_routes() -> list[APIRoute]:
    return [route for route in app.routes if isinstance(route, APIRoute)]


def test_runtime_has_no_duplicate_method_path_handlers() -> None:
    signatures: list[tuple[str, str]] = []
    for route in _api_routes():
        for method in sorted(route.methods or set()):
            signatures.append((method, route.path))

    duplicates = sorted(signature for signature, count in Counter(signatures).items() if count > 1)
    assert not duplicates, f"Duplicate runtime API handlers: {duplicates}"


def test_openapi_operation_ids_are_unique_and_present() -> None:
    schema = app.openapi()
    operation_ids: list[str] = []
    missing: list[str] = []

    for path, path_item in schema.get("paths", {}).items():
        for method, operation in path_item.items():
            if method.upper() not in HTTP_METHODS:
                continue
            operation_id = operation.get("operationId")
            if not operation_id:
                missing.append(f"{method.upper()} {path}")
            else:
                operation_ids.append(operation_id)

    duplicates = sorted(operation_id for operation_id, count in Counter(operation_ids).items() if count > 1)
    assert not missing, f"OpenAPI operations without operationId: {missing}"
    assert not duplicates, f"Duplicate OpenAPI operationId values: {duplicates}"


def test_safe_http_methods_do_not_accept_request_bodies() -> None:
    schema = app.openapi()
    violations: list[str] = []

    for path, path_item in schema.get("paths", {}).items():
        for method in SAFE_METHODS:
            operation = path_item.get(method.lower())
            if operation and "requestBody" in operation:
                violations.append(f"{method} {path}")

    assert not violations, f"Safe HTTP methods must not require request bodies: {violations}"


def test_api_paths_are_canonical() -> None:
    violations: list[str] = []
    for route in _api_routes():
        path = route.path
        if not path or path in FRAMEWORK_SURFACE_PATHS:
            continue
        if "//" in path:
            violations.append(f"double slash: {path}")
        if path != "/" and path.endswith("/"):
            violations.append(f"trailing slash: {path}")
        if path not in {"/health"} and not path.startswith(("/api/v1/", "/ws/")):
            violations.append(f"outside canonical surface: {path}")

    assert not violations, "Non-canonical API paths:\n" + "\n".join(sorted(violations))


def test_path_parameters_match_openapi_declarations() -> None:
    schema = app.openapi()
    violations: list[str] = []

    for path, path_item in schema.get("paths", {}).items():
        declared_in_path = set(PATH_PARAMETER_PATTERN.findall(path))
        shared_parameters = path_item.get("parameters", [])
        shared_path_parameters = {
            parameter.get("name")
            for parameter in shared_parameters
            if parameter.get("in") == "path"
        }
        for method, operation in path_item.items():
            if method.upper() not in HTTP_METHODS:
                continue
            declared_by_operation = shared_path_parameters | {
                parameter.get("name")
                for parameter in operation.get("parameters", [])
                if parameter.get("in") == "path"
            }
            if declared_in_path != declared_by_operation:
                violations.append(
                    f"{method.upper()} {path}: path={sorted(declared_in_path)} schema={sorted(declared_by_operation)}"
                )

    assert not violations, "Path parameter mismatches:\n" + "\n".join(violations)
