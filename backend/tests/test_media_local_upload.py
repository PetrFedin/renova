"""DOC-011/012: локальная загрузка по upload_url и presign от публичного endpoint."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.api.v1 import media
from app.main import app
from app.services import storage_service as storage


def test_upload_token_bound_to_key_and_expiry():
    key = "project-media/0b1c2d3e-0000-4000-8000-000000000001/abc.pdf"
    token = media._mint_upload_token(key)
    assert media._upload_token_valid(key, token)
    assert not media._upload_token_valid("project-media/p1/other.pdf", token)
    assert not media._upload_token_valid(key, media._mint_upload_token(key, expires_at=1))
    assert not media._upload_token_valid(key, None)


@pytest.mark.asyncio
async def test_local_put_writes_file_with_token_only(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "s3_endpoint", None)
    monkeypatch.setattr(storage.settings, "s3_access_key", None)
    monkeypatch.setattr(storage.settings, "s3_secret_key", None)
    monkeypatch.setattr(storage.settings, "uploads_dir", str(tmp_path))
    key = "project-media/0b1c2d3e-0000-4000-8000-000000000001/abc.pdf"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.put(f"/api/v1/media/{key}", content=b"x")).status_code == 403
        r = await c.put(f"/api/v1/media/{key}?upload_token={media._mint_upload_token(key)}", content=b"%PDF-1")
        assert r.status_code == 200
    assert await storage.read_bytes(key) == b"%PDF-1"


def test_presign_uses_public_endpoint(monkeypatch):
    for name, value in (
        ("s3_endpoint", "http://minio:9000"), ("s3_access_key", "a"), ("s3_secret_key", "b"),
        ("s3_public_url", "https://files.example.com"),
    ):
        monkeypatch.setattr(storage.settings, name, value)
    assert storage.presigned_put("project-media/p1/a.pdf").startswith("https://files.example.com/")
    assert storage.presigned_url("project-media/p1/a.pdf").startswith("https://files.example.com/")
    monkeypatch.setattr(storage.settings, "s3_public_url", "")
    assert storage.presigned_url("project-media/p1/a.pdf").startswith("http://minio:9000/")


def test_local_profile_presigned_links_are_host_reachable(monkeypatch):
    """DOC-012: compose API sees MinIO as minio:9000, links must use 127.0.0.1:9000."""
    from pathlib import Path

    example = (Path(__file__).resolve().parents[2] / "env.local.example").read_text(encoding="utf-8")
    public = next(l.split("=", 1)[1].strip() for l in example.splitlines() if l.startswith("S3_PUBLIC_URL="))
    assert public == "http://127.0.0.1:9000"
    for name, value in (
        ("s3_endpoint", "http://minio:9000"), ("s3_access_key", "renova"),
        ("s3_secret_key", "renova123"), ("s3_public_url", public),
    ):
        monkeypatch.setattr(storage.settings, name, value)
    for url in (storage.presigned_put("project-media/p1/a.pdf"), storage.presigned_url("project-media/p1/a.pdf")):
        assert url.startswith("http://127.0.0.1:9000/renova/") and "minio" not in url
