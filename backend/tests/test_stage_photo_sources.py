"""Фото этапа принимается всеми способами, которые обещает схема.

``StagePhotoIn`` разрешает ``image_data``, ``storage_key`` и ``image_url`` —
все необязательные. Сервис же брал готовый файл только когда переданы
**оба** поля сразу, а иначе безусловно пытался декодировать base64 и падал
``ValueError: empty_image_payload`` — то есть HTTP 500.

Фото — обязательный пункт гейта сдачи этапа (`photos_after`). Клиент,
который заливает файл в хранилище отдельно и присылает только ключ, сдать
этап не мог.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models.entities import Project, Stage, StageStatus, User, UserRole
import app.models.outbox_runtime  # noqa: F401
import app.models.work_schedule  # noqa: F401
from app.services import stage_service


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def stage(db) -> Stage:
    customer = User(id="c-photo", phone="+79990005555", role=UserRole.customer)
    contractor = User(id="k-photo", phone="+78880005555", role=UserRole.contractor)
    project = Project(
        id="p-photo",
        name="Объект",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=contractor.id,
    )
    row = Stage(
        id="s-photo",
        project_id=project.id,
        name="Демонтаж",
        sort_order=0,
        status=StageStatus.active,
        payment_amount=1000,
        weight_coefficient=1.0,
    )
    db.add_all([customer, contractor, project, row])
    await db.commit()
    return row


@pytest.mark.asyncio
async def test_a_storage_key_alone_is_enough(db, stage):
    """Клиент залил файл сам и прислал только ключ."""
    photo = await stage_service.add_photo(
        db,
        stage.id,
        "k-photo",
        None,
        "после демонтажа",
        storage_key="stages/after-1.jpg",
    )

    assert photo.storage_key == "stages/after-1.jpg"
    assert photo.image_url, "по ключу должна строиться ссылка, иначе фото не показать"
    assert "stages/after-1.jpg" in photo.image_url


@pytest.mark.asyncio
async def test_an_image_url_alone_is_enough(db, stage):
    photo = await stage_service.add_photo(
        db,
        stage.id,
        "k-photo",
        None,
        "после демонтажа",
        image_url="https://cdn.example.com/stages/after-2.jpg",
    )

    assert photo.image_url == "https://cdn.example.com/stages/after-2.jpg"
    assert photo.storage_key, "ключ нужен для удаления и переноса файла"


@pytest.mark.asyncio
async def test_both_together_are_kept_as_given(db, stage):
    photo = await stage_service.add_photo(
        db,
        stage.id,
        "k-photo",
        None,
        None,
        storage_key="stages/after-3.jpg",
        image_url="https://cdn.example.com/stages/after-3.jpg",
    )

    assert photo.storage_key == "stages/after-3.jpg"
    assert photo.image_url == "https://cdn.example.com/stages/after-3.jpg"


@pytest.mark.asyncio
async def test_nothing_at_all_is_refused_clearly(db, stage):
    """Пустой запрос — это ошибка ввода, а не падение сервера."""
    with pytest.raises(ValueError) as caught:
        await stage_service.add_photo(db, stage.id, "k-photo", None, "без файла")

    assert str(caught.value) == "stage_photo_source_required", (
        f"нужна внятная причина отказа, а не {caught.value!r}"
    )


@pytest.mark.asyncio
async def test_a_link_in_image_data_still_works(db, stage):
    """Прежний путь: ссылка приходит в image_data — его нельзя ломать."""
    photo = await stage_service.add_photo(
        db,
        stage.id,
        "k-photo",
        "https://cdn.example.com/stages/legacy.jpg",
        None,
    )

    assert photo.image_url == "https://cdn.example.com/stages/legacy.jpg"
    assert photo.storage_key


@pytest.mark.asyncio
async def test_the_route_answers_422_not_500(tmp_path, monkeypatch):
    """Пустой запрос должен доходить до пользователя как ошибка ввода."""
    from httpx import ASGITransport, AsyncClient

    from app.core import config as cfg
    from app.db.session import init_db
    from app.main import app as fastapi_app
    from app.services.seed_articles import seed_articles
    from app.services.seed_demo import ensure_demo_users

    url = f"sqlite+aiosqlite:///{tmp_path}/photo.db"
    monkeypatch.setenv("DATABASE_URL", url)
    cfg.settings.database_url = url
    cfg.settings.public_base_url = "http://127.0.0.1:8081"
    from app.db import session as sess
    import sqlalchemy.ext.asyncio as sa

    sess.engine = sa.create_async_engine(url, echo=False)
    sess.SessionLocal = sa.async_sessionmaker(sess.engine, expire_on_commit=False)
    await init_db()
    async with sess.SessionLocal() as db:
        await ensure_demo_users(db)
        await seed_articles(db)

    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
        contractor = (await client.post("/api/v1/auth/demo", json={"role": "contractor"})).json()
        headers = {"X-User-Id": contractor["id"]}
        project = (await client.get("/api/v1/projects", headers=headers)).json()[0]
        detail = (await client.get(f"/api/v1/projects/{project['id']}", headers=headers)).json()
        stage_id = detail["stages"][0]["id"]

        empty = await client.post(
            f"/api/v1/projects/{project['id']}/stages/{stage_id}/photos",
            headers=headers,
            json={"caption": "без файла"},
        )
        assert empty.status_code == 422, f"{empty.status_code} {empty.text[:160]}"

        by_key = await client.post(
            f"/api/v1/projects/{project['id']}/stages/{stage_id}/photos",
            headers=headers,
            json={"caption": "после", "storage_key": "stages/after.jpg"},
        )
        assert by_key.status_code == 200, f"{by_key.status_code} {by_key.text[:160]}"
