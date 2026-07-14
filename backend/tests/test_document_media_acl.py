"""Wave 3: parse + soft for documents/{project_id}/… media keys."""
from app.services.document_media_acl import parse_document_media_key


def test_parse_document_media_key_uuid():
    pid = "1a53458d-2e03-4912-bf41-8e8ca8d097a1"
    k = parse_document_media_key(f"documents/{pid}/hosts-note.txt")
    assert k is not None
    assert k.project_id == pid
    assert k.relative_path == "hosts-note.txt"


def test_parse_rejects_photos_and_traversal():
    assert parse_document_media_key("photos/abc.jpg") is None
    assert parse_document_media_key("documents/") is None
    assert parse_document_media_key("documents/only-id") is None
    assert parse_document_media_key("documents/bad/../x/file.txt") is None
