import base64
from pathlib import Path

import pytest

from app.services import storage_service as storage


@pytest.fixture
def local_storage(monkeypatch, tmp_path):
    monkeypatch.setattr(storage.settings, "uploads_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(storage.settings, "public_base_url", "https://api.example.com")
    monkeypatch.setattr(storage.settings, "s3_endpoint", None)
    monkeypatch.setattr(storage.settings, "s3_access_key", None)
    monkeypatch.setattr(storage.settings, "s3_secret_key", None)
    monkeypatch.setattr(storage.settings, "s3_public_url", "https://stale-s3.example.com")
    monkeypatch.setattr(storage.settings, "cloudfront_domain", None)
    monkeypatch.setattr(storage.settings, "cloudfront_key_id", None)
    return tmp_path / "uploads"


def configure_s3(monkeypatch):
    monkeypatch.setattr(storage.settings, "s3_endpoint", "https://s3.example.com")
    monkeypatch.setattr(storage.settings, "s3_access_key", "access")
    monkeypatch.setattr(storage.settings, "s3_secret_key", "secret")
    monkeypatch.setattr(storage.settings, "s3_bucket", "renova")


def test_default_bucket_alone_does_not_enable_s3(local_storage):
    assert storage.settings.s3_bucket
    assert storage._s3_config_state() == "disabled"


def test_partial_s3_configuration_fails_closed(monkeypatch, local_storage):
    monkeypatch.setattr(storage.settings, "s3_endpoint", "https://s3.example.com")
    assert storage._s3_config_state() == "partial"
    with pytest.raises(storage.StorageConfigurationError, match="partial_s3_configuration"):
        storage._s3_client()


@pytest.mark.asyncio
async def test_local_save_is_atomic_readable_and_uses_local_api_url(local_storage):
    key, url = await storage.save_bytes(
        b"document-body",
        folder="documents",
        filename="счёт 1.pdf",
        content_type="application/pdf",
    )

    assert url.startswith("https://api.example.com/api/v1/media/")
    assert "stale-s3.example.com" not in url
    assert "%D1%81" in url and "%20" in url
    assert await storage.read_bytes(key) == b"document-body"
    assert not list(local_storage.rglob("*.tmp"))


@pytest.mark.parametrize(
    "key",
    ["../secret", "folder/../../secret", "/absolute/path", "folder\\..\\secret", ""],
)
def test_storage_key_rejects_traversal_and_absolute_paths(key):
    with pytest.raises(storage.InvalidStorageKey):
        storage.normalize_storage_key(key)


@pytest.mark.asyncio
async def test_invalid_base64_is_rejected_without_creating_file(local_storage):
    with pytest.raises(ValueError, match="invalid_image_base64"):
        await storage.save_image("data:image/png;base64,not-valid!!!")
    assert not list(local_storage.rglob("*.*"))


@pytest.mark.asyncio
async def test_image_size_is_rejected_instead_of_truncated(monkeypatch, local_storage):
    monkeypatch.setattr(storage, "MAX_IMAGE_BYTES", 3)
    payload = base64.b64encode(b"1234").decode("ascii")
    with pytest.raises(ValueError, match="image_too_large"):
        await storage.save_image(payload)
    assert not list(local_storage.rglob("*.*"))


@pytest.mark.asyncio
async def test_png_data_url_preserves_extension_and_bytes(local_storage):
    data = b"\x89PNG\r\n\x1a\ncontent"
    payload = "data:image/png;base64," + base64.b64encode(data).decode("ascii")
    key, _ = await storage.save_image(payload)

    assert key.endswith(".png")
    assert await storage.read_image(key) == data


@pytest.mark.asyncio
async def test_configured_s3_write_failure_never_falls_back_to_local(monkeypatch, local_storage):
    configure_s3(monkeypatch)

    class FailingClient:
        def put_object(self, **_):
            raise RuntimeError("s3 down")

    monkeypatch.setattr(storage, "_s3_client", lambda: FailingClient())

    with pytest.raises(storage.StorageUnavailable, match="s3_write_failed"):
        await storage.save_bytes(b"must-not-fallback", filename="file.bin")

    assert not list(local_storage.rglob("*.*"))


@pytest.mark.asyncio
async def test_missing_s3_object_returns_none_but_service_failure_raises(monkeypatch, local_storage):
    configure_s3(monkeypatch)

    class MissingError(Exception):
        response = {
            "Error": {"Code": "NoSuchKey"},
            "ResponseMetadata": {"HTTPStatusCode": 404},
        }

    class MissingClient:
        def get_object(self, **_):
            raise MissingError()

    monkeypatch.setattr(storage, "_s3_client", lambda: MissingClient())
    assert await storage.read_image("documents/missing.pdf") is None

    class DownClient:
        def get_object(self, **_):
            raise RuntimeError("network")

    monkeypatch.setattr(storage, "_s3_client", lambda: DownClient())
    with pytest.raises(storage.StorageUnavailable, match="s3_read_failed"):
        await storage.read_image("documents/existing.pdf")


def test_cloudfront_scheme_is_removed_as_prefix_not_character_set(monkeypatch, local_storage):
    monkeypatch.setattr(storage.settings, "cloudfront_domain", "https://static.example.com")
    monkeypatch.setattr(storage.settings, "cloudfront_key_id", None)

    assert storage._cloudfront_domain() == "static.example.com"
    assert storage.generate_cloudfront_signed_url("photos/фото 1.jpg") == (
        "https://static.example.com/photos/%D1%84%D0%BE%D1%82%D0%BE%201.jpg"
    )


def test_cloudfront_configured_signing_never_falls_back_unsigned(monkeypatch, local_storage):
    monkeypatch.setattr(storage.settings, "cloudfront_domain", "https://private.example.com")
    monkeypatch.setattr(storage.settings, "cloudfront_key_id", "KEY123")

    with pytest.raises(storage.StorageConfigurationError, match="cloudfront_private_key_missing"):
        storage.generate_cloudfront_signed_url("private/document.pdf")


def test_api_has_safe_storage_error_mapping():
    backend = Path(__file__).resolve().parents[1]
    source = (backend / "app" / "main.py").read_text(encoding="utf-8")

    assert "@app.exception_handler(InvalidStorageKey)" in source
    assert "status_code=400" in source
    assert "app.add_exception_handler(StorageUnavailable" in source
    assert "app.add_exception_handler(StorageConfigurationError" in source
    assert "status_code=503" in source
    assert "Хранилище временно недоступно" in source
