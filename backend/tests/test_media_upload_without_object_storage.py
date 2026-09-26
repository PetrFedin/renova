"""A photo must actually be stored, or the upload must fail.

`POST /media/upload-url` allocates a key and offers a presigned S3 URL. Without
object storage configured there is no presigned URL, and the endpoint returned
`upload_url: null` — with the key still allocated.

The client treated the key as a receipt: it skipped the PUT and returned it as
a success. So the reference was saved against a file that had never been
written, and every later read answered 404, while the user was told «фото
прикреплено». On the floor plan, which is the only place a defect can be
created, that is the whole feature.

A key is an allocation, not a receipt. There is now a direct upload route that
cannot report success without having written the file, and the endpoint always
offers at least one way to finish.
"""

from __future__ import annotations

import io

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config as cfg
from app.db.session import init_db
from app.main import app
from app.services.seed_articles import seed_articles
from app.services.seed_demo import ensure_demo_users

pytestmark = pytest.mark.asyncio

# A one-pixel PNG: small, valid, and unmistakably an image.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000100ffff03000006000557bfabd400"
    "00000049454e44ae426082"
)


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "media.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    # No object storage: the case the defect lived in.
    monkeypatch.setattr(cfg.settings, "uploads_dir", str(tmp_path / "uploads"))

    from app.db import session as sess

    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _headers(client):
    user = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    return {"X-User-Id": user["id"]}


async def test_a_way_to_finish_is_always_offered():
    """Without this the client has an allocated key and nowhere to send bytes."""
    async with _client() as client:
        headers = await _headers(client)

        allocated = await client.post("/api/v1/media/upload-url", headers=headers)
        assert allocated.status_code == 200, allocated.text
        body = allocated.json()

        assert body["key"].startswith("photos/")
        assert body["upload_url"] is None, "no object storage in this configuration"
        assert body["direct_upload_url"], (
            "with no presigned URL the client must still have somewhere to upload"
        )


async def test_the_photo_is_readable_after_a_direct_upload():
    """The end-to-end property: what was uploaded can be fetched back."""
    async with _client() as client:
        headers = await _headers(client)

        uploaded = await client.post(
            "/api/v1/media/upload",
            headers=headers,
            files={"file": ("defect.png", io.BytesIO(PNG), "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        key = uploaded.json()["key"]
        assert key

        fetched = await client.get(f"/api/v1/media/{key}", headers=headers)
        assert fetched.status_code == 200, (
            "the key was reported as stored, so it must be readable"
        )
        assert fetched.content == PNG


async def test_an_allocated_key_is_not_readable_until_something_is_uploaded():
    """Guards the guard: the previous test would also pass if every key read.

    This is the state the old client left behind on every photo — a key that
    had been handed out and never written.
    """
    async with _client() as client:
        headers = await _headers(client)

        key = (await client.post("/api/v1/media/upload-url", headers=headers)).json()["key"]

        fetched = await client.get(f"/api/v1/media/{key}", headers=headers)
        assert fetched.status_code == 404, (
            "an allocation is not a receipt; nothing was uploaded yet"
        )


async def test_an_empty_or_oversized_or_non_image_upload_is_refused():
    async with _client() as client:
        headers = await _headers(client)

        empty = await client.post(
            "/api/v1/media/upload",
            headers=headers,
            files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
        )
        assert empty.status_code == 400

        not_an_image = await client.post(
            "/api/v1/media/upload",
            headers=headers,
            files={"file": ("payload.exe", io.BytesIO(b"MZ\x90\x00"), "application/x-msdownload")},
        )
        assert not_an_image.status_code == 415

        from app.api.v1.media import MAX_MEDIA_BYTES

        too_big = await client.post(
            "/api/v1/media/upload",
            headers=headers,
            files={"file": ("big.png", io.BytesIO(b"\x00" * (MAX_MEDIA_BYTES + 1)), "image/png")},
        )
        assert too_big.status_code == 413


async def test_uploading_requires_authentication():
    async with _client() as client:
        anonymous = await client.post(
            "/api/v1/media/upload",
            files={"file": ("defect.png", io.BytesIO(PNG), "image/png")},
        )
        assert anonymous.status_code == 401
