"""Durable media storage with explicit S3/local modes and fail-closed errors."""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import logging
import os
import uuid
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from app.core.config import settings

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 10 * 1024 * 1024
_IMAGE_TYPES = {
    "image/jpeg": ("jpg", "image/jpeg"),
    "image/jpg": ("jpg", "image/jpeg"),
    "image/png": ("png", "image/png"),
    "image/webp": ("webp", "image/webp"),
}


class StorageError(RuntimeError):
    """Base storage error safe to map to service-unavailable at the API boundary."""


class InvalidStorageKey(StorageError):
    pass


class StorageConfigurationError(StorageError):
    pass


class StorageUnavailable(StorageError):
    pass


def normalize_storage_key(key: str) -> str:
    """Return a canonical relative POSIX key and reject traversal/absolute paths."""
    raw = (key or "").strip().replace("\\", "/")
    if not raw or raw.startswith("/") or "\x00" in raw:
        raise InvalidStorageKey("invalid_storage_key")
    parts = PurePosixPath(raw).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise InvalidStorageKey("invalid_storage_key")
    return "/".join(parts)


def _local_root() -> Path:
    root = Path(settings.uploads_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _local_path(key: str) -> Path:
    normalized = normalize_storage_key(key)
    root = _local_root()
    candidate = (root / normalized).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise InvalidStorageKey("invalid_storage_key") from exc
    return candidate


def _s3_config_state() -> str:
    """Bucket default alone does not enable S3; connection credentials do."""
    connection = (
        settings.s3_endpoint,
        settings.s3_access_key,
        settings.s3_secret_key,
    )
    configured = [bool((value or "").strip()) for value in connection]
    if not any(configured):
        return "disabled"
    if all(configured) and bool((settings.s3_bucket or "").strip()):
        return "configured"
    return "partial"


def _s3_client():
    state = _s3_config_state()
    if state == "disabled":
        return None
    if state == "partial":
        raise StorageConfigurationError("partial_s3_configuration")
    try:
        import boto3
        from botocore.client import Config

        return boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
        )
    except Exception as exc:
        logger.exception("S3 client initialization failed")
        raise StorageUnavailable("s3_client_unavailable") from exc


def _encoded_key(key: str) -> str:
    return quote(normalize_storage_key(key), safe="/")


def _local_url(key: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/api/v1/media/{_encoded_key(key)}"


def _s3_public_url(key: str) -> str:
    encoded = _encoded_key(key)
    if settings.s3_public_url:
        return f"{settings.s3_public_url.rstrip('/')}/{settings.s3_bucket}/{encoded}"
    return _local_url(key)


def _decode_image(payload: str) -> tuple[bytes, str, str]:
    if not isinstance(payload, str) or not payload.strip():
        raise ValueError("empty_image_payload")
    raw = payload.strip()
    content_type = "image/jpeg"
    if raw.startswith("data:"):
        if "," not in raw:
            raise ValueError("invalid_image_data_url")
        header, raw = raw.split(",", 1)
        if ";base64" not in header.lower():
            raise ValueError("image_data_url_must_be_base64")
        content_type = header[5:].split(";", 1)[0].lower()
    image_type = _IMAGE_TYPES.get(content_type)
    if image_type is None:
        raise ValueError("unsupported_image_type")
    extension, normalized_content_type = image_type
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid_image_base64") from exc
    if not data:
        raise ValueError("empty_image_payload")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image_too_large")
    return data, extension, normalized_content_type


def _write_local_sync(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp.write_bytes(data)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


async def _put_s3(client, *, key: str, data: bytes, content_type: str) -> None:
    try:
        await asyncio.to_thread(
            client.put_object,
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    except Exception as exc:
        logger.exception("S3 put_object failed", extra={"storage_key": key})
        raise StorageUnavailable("s3_write_failed") from exc


async def _write_local(key: str, data: bytes) -> None:
    await asyncio.to_thread(_write_local_sync, _local_path(key), data)


async def save_image(base64_or_data_url: str, *, folder: str = "photos") -> tuple[str, str]:
    data, extension, content_type = _decode_image(base64_or_data_url)
    safe_folder = normalize_storage_key(folder)
    key = normalize_storage_key(f"{safe_folder}/{uuid.uuid4().hex}.{extension}")
    client = _s3_client()
    if client is not None:
        await _put_s3(client, key=key, data=data, content_type=content_type)
        return key, _s3_public_url(key)
    await _write_local(key, data)
    return key, _local_url(key)


async def save_bytes(
    data: bytes,
    *,
    folder: str = "documents",
    filename: str | None = None,
    content_type: str = "application/octet-stream",
) -> tuple[str, str]:
    """Save arbitrary bytes to configured S3 or intentional local storage."""
    if not isinstance(data, bytes) or not data:
        raise ValueError("empty_file_payload")
    safe_folder = normalize_storage_key(folder)
    safe_name = (filename or "file.bin").replace("/", "_").replace("\\", "_")[-120:]
    if safe_name in {"", ".", ".."} or "\x00" in safe_name:
        raise ValueError("invalid_filename")
    digest = hashlib.sha256(data).hexdigest()[:16]
    key = normalize_storage_key(f"{safe_folder}/{uuid.uuid4().hex}_{digest}_{safe_name}")
    client = _s3_client()
    if client is not None:
        await _put_s3(client, key=key, data=data, content_type=content_type)
        return key, _s3_public_url(key)
    await _write_local(key, data)
    return key, _local_url(key)


async def read_bytes(key: str) -> bytes | None:
    return await read_image(key)


def _is_missing_s3_object(error: Exception) -> bool:
    response = getattr(error, "response", None)
    if not isinstance(response, dict):
        return False
    error_data = response.get("Error") or {}
    metadata = response.get("ResponseMetadata") or {}
    code = str(error_data.get("Code") or "")
    status = metadata.get("HTTPStatusCode")
    return code in {"NoSuchKey", "NotFound", "404"} or status == 404


async def read_image(key: str) -> bytes | None:
    normalized = normalize_storage_key(key)
    client = _s3_client()
    if client is not None:
        try:
            response = await asyncio.to_thread(
                client.get_object,
                Bucket=settings.s3_bucket,
                Key=normalized,
            )
            return await asyncio.to_thread(response["Body"].read)
        except Exception as exc:
            if _is_missing_s3_object(exc):
                return None
            logger.exception("S3 get_object failed", extra={"storage_key": normalized})
            raise StorageUnavailable("s3_read_failed") from exc
    path = _local_path(normalized)
    if not path.is_file():
        return None
    return await asyncio.to_thread(path.read_bytes)


def ensure_bucket() -> None:
    client = _s3_client()
    if client is None:
        logger.info("storage mode=local root=%s", _local_root())
        return
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except Exception:
        try:
            client.create_bucket(Bucket=settings.s3_bucket)
        except Exception as exc:
            logger.exception("S3 bucket unavailable", extra={"bucket": settings.s3_bucket})
            raise StorageUnavailable("s3_bucket_unavailable") from exc
    logger.info("storage mode=s3 bucket=%s", settings.s3_bucket)


def presigned_url(key: str, expires: int = 3600) -> str | None:
    normalized = normalize_storage_key(key)
    client = _s3_client()
    if client is None:
        return None
    cf = generate_cloudfront_signed_url(normalized, expires)
    if cf:
        return cf
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": normalized},
            ExpiresIn=expires,
        )
    except Exception as exc:
        logger.exception("S3 presigned GET failed", extra={"storage_key": normalized})
        raise StorageUnavailable("s3_presign_failed") from exc


def presigned_put(key: str, expires: int = 900) -> str | None:
    normalized = normalize_storage_key(key)
    client = _s3_client()
    if client is None:
        return None
    try:
        return client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": normalized,
                "ContentType": "image/jpeg",
            },
            ExpiresIn=expires,
        )
    except Exception as exc:
        logger.exception("S3 presigned PUT failed", extra={"storage_key": normalized})
        raise StorageUnavailable("s3_presign_failed") from exc


def cloudfront_signed_url(key: str, expires: int = 3600) -> str | None:
    """Deprecated alias — use generate_cloudfront_signed_url."""
    return generate_cloudfront_signed_url(key, expires)


def _cloudfront_domain() -> str:
    domain = (settings.cloudfront_domain or "").strip()
    if domain.startswith("https://"):
        domain = domain[len("https://"):]
    elif domain.startswith("http://"):
        domain = domain[len("http://"):]
    return domain.rstrip("/")


def generate_cloudfront_signed_url(key: str, expires: int = 3600) -> str | None:
    normalized = normalize_storage_key(key)
    domain = _cloudfront_domain()
    if not domain:
        return None
    unsigned_url = f"https://{domain}/{_encoded_key(normalized)}"
    if not settings.cloudfront_key_id:
        return unsigned_url
    try:
        from datetime import datetime, timedelta, timezone
        from pathlib import Path as P

        import rsa
        from botocore.signers import CloudFrontSigner

        pk_path = P(settings.uploads_dir).parent / "cloudfront-private-key.pem"
        if not pk_path.is_file():
            raise StorageConfigurationError("cloudfront_private_key_missing")
        key_data = pk_path.read_bytes()
        signer = CloudFrontSigner(
            settings.cloudfront_key_id,
            lambda message: rsa.sign(
                message,
                rsa.PrivateKey.load_pkcs1(key_data),
                "SHA-1",
            ),
        )
        return signer.generate_presigned_url(
            unsigned_url,
            date_less_than=datetime.now(timezone.utc) + timedelta(seconds=expires),
        )
    except StorageConfigurationError:
        raise
    except Exception as exc:
        logger.exception("CloudFront signing failed", extra={"storage_key": normalized})
        raise StorageUnavailable("cloudfront_signing_failed") from exc
