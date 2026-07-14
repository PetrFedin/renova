"""Хранение фото: MinIO/S3 или локальная папка."""
import base64, uuid, io
from pathlib import Path
from app.core.config import settings

def _local_root() -> Path:
    p = Path(settings.uploads_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p

def _s3_client():
    if not settings.s3_endpoint or not settings.s3_access_key:
        return None
    try:
        import boto3
        from botocore.client import Config
        return boto3.client("s3", endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key, aws_secret_access_key=settings.s3_secret_key,
            config=Config(signature_version="s3v4"), region_name="us-east-1")
    except Exception:
        return None

async def save_image(base64_or_data_url: str, *, folder: str = "photos") -> tuple[str, str]:
    raw = base64_or_data_url.split(",", 1)[-1] if "," in base64_or_data_url else base64_or_data_url
    data = base64.b64decode(raw[:2_000_000])
    key = f"{folder}/{uuid.uuid4().hex}.jpg"
    client = _s3_client()
    if client:
        try:
            client.put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType="image/jpeg")
            url = (f"{settings.s3_public_url.rstrip('/')}/{settings.s3_bucket}/{key}" if settings.s3_public_url
                   else f"{settings.public_base_url}/api/v1/media/{key}")
            return key, url
        except Exception:
            pass
    path = _local_root() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    url = (f"{settings.s3_public_url.rstrip('/')}/{settings.s3_bucket}/{key}" if settings.s3_public_url
               else f"{settings.public_base_url}/api/v1/media/{key}")
    return key, url


async def save_bytes(
    data: bytes,
    *,
    folder: str = "documents",
    filename: str | None = None,
    content_type: str = "application/octet-stream",
) -> tuple[str, str]:
    """Save arbitrary file bytes to S3 or local uploads. Returns (storage_key, public_href)."""
    import hashlib
    safe_name = (filename or "file.bin").replace("/", "_").replace("\\", "_")[-120:]
    digest = hashlib.sha256(data).hexdigest()[:16]
    key = f"{folder}/{uuid.uuid4().hex}_{digest}_{safe_name}"
    client = _s3_client()
    if client:
        try:
            client.put_object(
                Bucket=settings.s3_bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
            url = (
                f"{settings.s3_public_url.rstrip('/')}/{settings.s3_bucket}/{key}"
                if settings.s3_public_url
                else f"{settings.public_base_url}/api/v1/media/{key}"
            )
            return key, url
        except Exception:
            pass
    path = _local_root() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    url = (
        f"{settings.s3_public_url.rstrip('/')}/{settings.s3_bucket}/{key}"
        if settings.s3_public_url
        else f"{settings.public_base_url}/api/v1/media/{key}"
    )
    return key, url


async def read_bytes(key: str) -> bytes | None:
    """Alias for binary download (same as read_image for local/S3)."""
    return await read_image(key)

async def read_image(key: str) -> bytes | None:
    client = _s3_client()
    if client:
        try:
            return client.get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()
        except Exception:
            pass
    path = _local_root() / key
    return path.read_bytes() if path.is_file() else None


def ensure_bucket() -> None:
    client = _s3_client()
    if not client:
        return
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except Exception:
        try:
            client.create_bucket(Bucket=settings.s3_bucket)
        except Exception:
            pass


def presigned_url(key: str, expires: int = 3600) -> str | None:
    """Return CloudFront/S3 signed URL, or None for local-disk fallback."""
    # Never recurse into generate_cloudfront_signed_url → presigned_url
    cf = generate_cloudfront_signed_url(key, expires)
    if cf:
        return cf
    client = _s3_client()
    if not client:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": key},
            ExpiresIn=expires,
        )
    except Exception:
        return None


def presigned_put(key: str, expires: int = 900) -> str | None:
    client = _s3_client()
    if not client:
        return None
    try:
        return client.generate_presigned_url("put_object", Params={"Bucket": settings.s3_bucket, "Key": key, "ContentType": "image/jpeg"}, ExpiresIn=expires)
    except Exception:
        return None


def cloudfront_signed_url(key: str, expires: int = 3600) -> str | None:
    """Deprecated alias — use generate_cloudfront_signed_url. No recursion."""
    return generate_cloudfront_signed_url(key, expires)


def generate_cloudfront_signed_url(key: str, expires: int = 3600) -> str | None:
    """CloudFront signed URL (prod). Returns None if CloudFront not configured (no recursion)."""
    if not settings.cloudfront_domain:
        return None
    domain = settings.cloudfront_domain.rstrip("/")
    if settings.cloudfront_key_id:
        try:
            from datetime import datetime, timedelta, timezone
            from botocore.signers import CloudFrontSigner
            import rsa
            from pathlib import Path as P
            pk_path = P(settings.uploads_dir).parent / "cloudfront-private-key.pem"
            if pk_path.is_file():
                key_data = pk_path.read_bytes()
                signer = CloudFrontSigner(settings.cloudfront_key_id, lambda m: rsa.sign(m, rsa.PrivateKey.load_pkcs1(key_data), "SHA-1"))
                url = f"https://{domain.lstrip('https://')}/{key}"
                return signer.generate_presigned_url(url, date_less_than=datetime.now(timezone.utc) + timedelta(seconds=expires))
        except Exception:
            pass
    return f"https://{domain.lstrip('https://')}/{key}"
