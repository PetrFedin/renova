"""Storage primitives for replay-safe document uploads.

Upload object keys are deterministic for one client command. Replaying the same
command therefore overwrites/repairs the same object instead of allocating a
second orphan. Cleanup is used only before a database commit is attempted;
commit-time failures remain replayable because commit outcome may be ambiguous.
"""
from __future__ import annotations

import asyncio
from urllib.parse import quote

from app.core.config import settings
from app.services import storage_service as storage_svc


def deterministic_document_key(
    *,
    project_id: str,
    user_id: str,
    request_id: str,
    checksum_sha256: str,
    filename: str | None,
) -> str:
    safe_name = (filename or "file.bin").replace("/", "_").replace("\\", "_")[-120:]
    if safe_name in {"", ".", ".."} or "\x00" in safe_name:
        safe_name = "file.bin"
    return storage_svc.normalize_storage_key(
        f"documents/{project_id}/{user_id}/{request_id}_{checksum_sha256[:16]}_{safe_name}"
    )


def media_href(key: str) -> str:
    normalized = storage_svc.normalize_storage_key(key)
    return f"{settings.public_base_url.rstrip('/')}/api/v1/media/{quote(normalized, safe='/')}"


async def delete_key_best_effort(key: str) -> None:
    """Remove a definitely-uncommitted upload without masking the primary error."""
    normalized = storage_svc.normalize_storage_key(key)
    try:
        client = storage_svc._s3_client()  # same storage adapter; cleanup only
        if client is not None:
            await asyncio.to_thread(
                client.delete_object,
                Bucket=settings.s3_bucket,
                Key=normalized,
            )
            return
        path = storage_svc._local_path(normalized)
        await asyncio.to_thread(path.unlink, missing_ok=True)
    except Exception:
        # The object key is deterministic. A later retry/reconciliation can safely
        # overwrite or remove the same key; never hide the original mutation error.
        return
