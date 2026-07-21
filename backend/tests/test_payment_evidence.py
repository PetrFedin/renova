"""Portal payment evidence: submit / approve / reject / security."""
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

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
JPEG = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
SPOOF = b"not-a-pdf-but-named-pdf" + b"\x00" * 32


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "pay_ev.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.secret_key = "test-secret-key-32chars-min!!"
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    sess.engine = create_async_engine(url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)


async def _actors(client: AsyncClient):
    cust = (await client.post("/api/v1/auth/demo", json={"role": "customer"})).json()
    cont = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
    h_c = {"X-User-Id": cust["id"]}
    h_t = {"X-User-Id": cont["id"]}
    pid = (await client.get("/api/v1/projects", headers=h_c)).json()[0]["id"]
    # create pending payment as contractor (stage/material) or customer advance
    pay = (
        await client.post(
            f"/api/v1/projects/{pid}/payments",
            headers=h_c,
            json={"title": "Аванс", "amount": 10000, "payment_type": "advance"},
        )
    ).json()
    return h_c, h_t, pid, pay["id"], cust, cont


def _multipart(data: bytes, filename: str, mime: str, **fields):
    files = {"file": (filename, io.BytesIO(data), mime)}
    return files, {k: str(v) for k, v in fields.items()}


async def test_submit_valid_pdf():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, _, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            PDF, "r.pdf", "application/pdf",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-pdf",
        )
        res = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-pdf"},
            files=files,
            data=data,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["payment"]["status"] == "paid_unverified"
        assert body["evidence"]["antivirus_scanned"] is False
        assert body["evidence"]["antivirus_status"] == "not_configured"
        assert body["message"]


async def test_submit_valid_image():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, _, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            JPEG, "r.jpg", "image/jpeg",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-jpg",
        )
        res = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-jpg"},
            files=files,
            data=data,
        )
        assert res.status_code == 200, res.text
        assert res.json()["payment"]["status"] == "paid_unverified"


async def test_unsupported_mime():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, _, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            b"plain text receipt", "r.txt", "text/plain",
            transfer_date="2026-07-20", claimed_amount="10000",
        )
        res = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers=h_c,
            files=files,
            data=data,
        )
        assert res.status_code == 400


async def test_oversized_file(monkeypatch):
    from app.services import payment_evidence_service as ev

    monkeypatch.setattr(ev, "MAX_EVIDENCE_BYTES", 100)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, _, pid, pay_id, *_ = await _actors(client)
        big = PDF + b"x" * 200
        files, data = _multipart(big, "big.pdf", "application/pdf", transfer_date="2026-07-20", claimed_amount="1")
        res = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers=h_c,
            files=files,
            data=data,
        )
        assert res.status_code == 413


async def test_mime_spoof():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, _, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            SPOOF, "fake.pdf", "application/pdf",
            transfer_date="2026-07-20", claimed_amount="10000",
        )
        res = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers=h_c,
            files=files,
            data=data,
        )
        assert res.status_code == 400
        assert res.json()["detail"]["code"] in ("unsupported_mime", "mime_spoof")


async def test_foreign_project():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, _, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(PDF, "r.pdf", "application/pdf", transfer_date="2026-07-20", claimed_amount="1")
        res = await client.post(
            f"/api/v1/projects/00000000-0000-0000-0000-000000000099/payments/{pay_id}/evidence",
            headers=h_c,
            files=files,
            data=data,
        )
        assert res.status_code in (403, 404)


async def test_unauthorized_approve():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, _, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            PDF, "r.pdf", "application/pdf",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-unauth",
        )
        await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-unauth"},
            files=files,
            data=data,
        )
        # customer cannot approve
        res = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence/approve",
            headers=h_c,
            json={},
        )
        assert res.status_code == 403


async def test_approve_valid_state():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, h_t, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            PDF, "r.pdf", "application/pdf",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-appr",
        )
        sub = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-appr"},
            files=files,
            data=data,
        )
        assert sub.status_code == 200
        ver = sub.json()["payment"]["lock_version"]
        res = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence/approve",
            headers=h_t,
            json={"expected_lock_version": ver},
        )
        assert res.status_code == 200, res.text
        assert res.json()["payment"]["status"] == "confirmed"


async def test_reject_with_and_without_reason():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, h_t, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            PNG, "r.png", "image/png",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-rej",
        )
        sub = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-rej"},
            files=files,
            data=data,
        )
        ver = sub.json()["payment"]["lock_version"]
        bad = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence/reject",
            headers=h_t,
            json={"reason": "", "expected_lock_version": ver},
        )
        assert bad.status_code == 400
        ok = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence/reject",
            headers=h_t,
            json={"reason": "Сумма не совпадает", "expected_lock_version": ver},
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["payment"]["status"] == "rejected"


async def test_concurrent_approve_reject():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, h_t, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            PDF, "r.pdf", "application/pdf",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-race",
        )
        sub = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-race"},
            files=files,
            data=data,
        )
        ver = sub.json()["payment"]["lock_version"]
        a = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence/approve",
            headers=h_t,
            json={"expected_lock_version": ver},
        )
        b = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence/reject",
            headers=h_t,
            json={"reason": "поздно", "expected_lock_version": ver},
        )
        assert a.status_code == 200
        assert b.status_code == 409
        final = await client.get(f"/api/v1/projects/{pid}/payments/{pay_id}/evidence", headers=h_t)
        assert final.json()["payment"]["status"] == "confirmed"


async def test_duplicate_submit_idempotent():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, _, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            PDF, "r.pdf", "application/pdf",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-dup",
        )
        r1 = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-dup"},
            files=files,
            data=data,
        )
        files2, data2 = _multipart(
            PDF, "r.pdf", "application/pdf",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-dup",
        )
        r2 = await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-dup"},
            files=files2,
            data=data2,
        )
        assert r1.status_code == 200 and r2.status_code == 200
        assert r2.json()["idempotent_replay"] is True
        assert r1.json()["evidence"]["id"] == r2.json()["evidence"]["id"]


async def test_audit_and_download_permissions():
    from app.db import session as sess
    from app.models.entities import PaymentEvent
    from sqlalchemy import select

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        h_c, h_t, pid, pay_id, *_ = await _actors(client)
        files, data = _multipart(
            PDF, "r.pdf", "application/pdf",
            transfer_date="2026-07-20", claimed_amount="10000", client_request_id="k-aud",
        )
        await client.post(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence",
            headers={**h_c, "Idempotency-Key": "k-aud"},
            files=files,
            data=data,
        )
        dl = await client.get(
            f"/api/v1/projects/{pid}/payments/{pay_id}/evidence/file",
            headers=h_t,
        )
        assert dl.status_code == 200
        assert dl.content.startswith(b"%PDF")
        # stranger
        guest = (await client.post("/api/v1/auth/demo", json={"role": "guest"})).json()
        if "id" in guest:
            bad = await client.get(
                f"/api/v1/projects/{pid}/payments/{pay_id}/evidence/file",
                headers={"X-User-Id": guest["id"]},
            )
            assert bad.status_code in (403, 404)
        async with sess.SessionLocal() as db:
            evs = (await db.execute(select(PaymentEvent).where(PaymentEvent.payment_id == pay_id))).scalars().all()
            types = {e.evidence_type for e in evs}
            assert "bank_statement" in types or "transfer_screenshot" in types
            assert "download" in types
            for e in evs:
                assert e.actor_user_id  # filled
