"""Исправленный файл становится версией документа, а не вторым документом."""
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import session as sess
from app.db.session import init_db
from app.main import app
from app.models.entities import Project, User, UserRole
from app.models.project_documents import DocumentVersion, ProjectDocument

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def setup_db(tmp_path, monkeypatch):
    db_path = tmp_path / "doc_versions.db"
    database_url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)

    from app.core import config

    # Движок и адрес базы глобальные: без возврата назад следующий файл тестов
    # получит ссылку на уже удалённый временный файл.
    previous_engine = sess.engine
    previous_session = sess.SessionLocal
    previous_url = config.settings.database_url

    config.settings.database_url = database_url
    sess.engine = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["create_async_engine"]
    ).create_async_engine(database_url, echo=False)
    sess.SessionLocal = __import__(
        "sqlalchemy.ext.asyncio", fromlist=["async_sessionmaker"]
    ).async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()

    async with sess.SessionLocal() as db:
        contractor = User(id="doc-cont", phone="+70000005001", role=UserRole.contractor)
        project = Project(
            id="doc-proj",
            name="Документы",
            renovation_type="cosmetic",
            customer_id="doc-cust",
            contractor_id=contractor.id,
            budget_planned=1000,
            budget_spent=0,
        )
        db.add_all([User(id="doc-cust", phone="+70000005002", role=UserRole.customer), contractor, project])
        await db.commit()

    yield

    await sess.engine.dispose()
    sess.engine = previous_engine
    sess.SessionLocal = previous_session
    config.settings.database_url = previous_url


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _upload(client: AsyncClient, *, content: bytes, document_id: str | None = None) -> dict:
    data = {"title": "Акт", "document_type": "upload"}
    if document_id:
        data["document_id"] = document_id
    resp = await client.post(
        "/api/v1/projects/doc-proj/documents/upload",
        headers={"X-User-Id": "doc-cont"},
        files={"file": ("akt.pdf", content, "application/pdf")},
        data=data,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _counts() -> tuple[int, int]:
    async with sess.SessionLocal() as db:
        docs = len((await db.execute(select(ProjectDocument))).scalars().all())
        versions = len((await db.execute(select(DocumentVersion))).scalars().all())
        return docs, versions


async def test_upload_without_document_id_creates_a_document():
    async with _client() as client:
        await _upload(client, content=b"%PDF-1.4 first")
    assert await _counts() == (1, 1)


async def test_upload_with_document_id_adds_a_version():
    """Иначе исправленный файл становится вторым документом, и какой из них
    действующий — не знает никто."""
    async with _client() as client:
        first = await _upload(client, content=b"%PDF-1.4 first")
        second = await _upload(client, content=b"%PDF-1.4 fixed", document_id=first["id"])
        assert second["id"] == first["id"]

    docs, versions = await _counts()
    assert docs == 1, "документ должен остаться один"
    assert versions == 2, "версий должно стать две"


async def test_new_version_becomes_the_current_one():
    async with _client() as client:
        first = await _upload(client, content=b"%PDF-1.4 first")
        await _upload(client, content=b"%PDF-1.4 fixed", document_id=first["id"])

    async with sess.SessionLocal() as db:
        doc = await db.get(ProjectDocument, first["id"])
        current = await db.get(DocumentVersion, doc.current_version_id)
        assert current.version_number == 2


async def test_unknown_document_id_is_refused():
    """Чужой или выдуманный идентификатор не должен молча заводить документ."""
    async with _client() as client:
        resp = await client.post(
            "/api/v1/projects/doc-proj/documents/upload",
            headers={"X-User-Id": "doc-cont"},
            files={"file": ("akt.pdf", b"%PDF-1.4", "application/pdf")},
            data={"document_id": "no-such-document"},
        )
        assert resp.status_code == 404, resp.text
    assert await _counts() == (0, 0)
