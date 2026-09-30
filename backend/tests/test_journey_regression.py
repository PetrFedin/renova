"""Сквозная РЕГРЕССИЯ жизненного цикла Renova (наследник docs/audit-map/journey-script-13.py).

In-process ASGI, изолированная файловая SQLite, настоящая авторизация по JWT (OTP dev-preview).
Живой backend :8100 и демо-база не используются. Тесты идут по порядку и делят один «мир»
(module-scope): заказчик -> заявка исполнителя -> подтверждение -> смета -> propose/lock ->
договор двумя подписями -> график -> этап -> работа -> сдача -> приёмка -> счёт/оплата ->
допработы -> закупка -> закрытие -> гарантия -> корзина/purge.

Каждый шаг проверяет ожидаемый статус и ключевые поля. Негативные ветки аудита стали проверками
защиты (волна 0). Дефекты, которые ещё воспроизводятся (волны 1-2), помечены
`xfail(strict=True)` с ID из реестра JRN: когда исправление попадёт в main, тест станет XPASS
и потребует снять пометку. Ожидания под дефект не подгоняются.
"""
from __future__ import annotations

import base64
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app

from app.models import (  # noqa: F401  (регистрация таблиц в метаданных)
    entities, outbox_runtime, project_assignment_requests, project_documents, work_schedule,
)

pytestmark = pytest.mark.asyncio(loop_scope="module")

PNG = "data:image/png;base64," + base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082"
    )
).decode()

ROOMS = [
    {"name": "Гостиная", "area_sqm": 20, "length_m": 5, "width_m": 4},
    {"name": "Кухня", "area_sqm": 12, "length_m": 4, "width_m": 3},
]


class World:
    """Клиент + пользователи + общий контекст сценария."""

    def __init__(self, client: AsyncClient):
        self.c = client
        self.h: dict[str, dict[str, str]] = {}
        self.u: dict[str, dict] = {}
        self.s: dict = {}

    async def call(self, who, method, path, json=None, expect=None, **kw):
        headers = dict(self.h.get(who, {})) if who else {}
        headers.update(kw.pop("headers", {}))
        r = await self.c.request(method, "/api/v1" + path, headers=headers, json=json, **kw)
        if expect is not None:
            ok = r.status_code in (expect if isinstance(expect, (tuple, list, set)) else (expect,))
            assert ok, f"{who} {method} {path} -> {r.status_code}, ожидалось {expect}: {r.text[:500]}"
        return r

    async def register(self, who, phone, role, name):
        r = await self.call(None, "POST", "/auth/sms/send", {"phone": phone}, expect=200)
        code = r.json().get("demo_code")
        assert code, "OTP dev-preview должен отдавать demo_code в окружении test"
        r = await self.call(
            None, "POST", "/auth/sms/verify",
            {"phone": phone, "code": code, "role": role, "full_name": name}, expect=200,
        )
        data = r.json()
        self.u[who] = data
        self.h[who] = {"Authorization": f"Bearer {data['access_token']}"}


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def w():
    tmp = tempfile.mkdtemp(prefix="journey_reg_")
    engine = create_async_engine(f"sqlite+aiosqlite:///{Path(tmp) / 'journey.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def _db():
        async with Session() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    # Фоновые побочные эффекты (push/аудит/outbox) открывают SessionLocal напрямую — перенаправляем
    # их на ту же изолированную базу, чтобы тест не писал в локальную renova.db.
    import sys
    from app.db import session as db_session

    patched: list[tuple[object, str, object]] = []
    for mod in list(sys.modules.values()):
        if getattr(mod, "__name__", "").startswith("app."):
            for attr in ("SessionLocal", "engine"):
                if getattr(mod, attr, None) is getattr(db_session, attr):
                    patched.append((mod, attr, getattr(mod, attr)))
    for mod, attr, _old in patched:
        setattr(mod, attr, Session if attr == "SessionLocal" else engine)
    old_limit = settings.contractor_free_project_limit
    settings.contractor_free_project_limit = 99  # JRN-010 (лимит Pro) здесь не проверяется
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield World(client)
    finally:
        settings.contractor_free_project_limit = old_limit
        app.dependency_overrides.pop(get_db, None)
        for mod, attr, old in patched:
            setattr(mod, attr, old)
        await engine.dispose()


def P(w):
    return f"/projects/{w.s['pid']}"


async def new_project(w, name="Проект", who="cust"):
    r = await w.call(who, "POST", "/projects", {
        "name": name, "address": "Москва", "renovation_type": "cosmetic",
        "property_type": "apartment", "total_area_sqm": 30,
        "rooms": [{"name": "Комната", "area_sqm": 15, "length_m": 5, "width_m": 3}],
    }, expect=200)
    return r.json()


async def connect(w, pid, who="lead", customer="cust"):
    """Заявка исполнителя + подтверждение заказчиком (новый порядок)."""
    r = await w.call(who, "POST", f"/projects/{pid}/assign", expect=202)
    req = r.json()["request"]["id"]
    await w.call(customer, "POST", f"/projects/{pid}/assignment-requests/{req}/accept", expect=200)
    return req


async def lead_id(w, pid):
    """Текущий ведущий исполнитель проекта глазами заказчика (ProjectOut contractor_id не отдаёт)."""
    r = await w.call("cust", "GET", f"/projects/{pid}/participants", expect=200)
    leads = [p["user_id"] for p in r.json() if p.get("is_current_lead")]
    return leads[0] if leads else None


def stage_id(w, name):
    return next(s["id"] for s in w.s["stages"] if s["name"] == name)


# ---------------------------------------------------------------- 1. регистрация и проект

async def test_01_registration(w):
    await w.register("cust", "+79001110001", "customer", "Иван Заказчиков")
    await w.register("lead", "+79001110002", "contractor", "Пётр Подрядов")
    await w.register("other", "+79001110003", "contractor", "Чужой Подрядчик")
    await w.register("guest", "+79001110004", "customer", "Гость Наблюдатель")
    assert w.u["cust"]["role"] == "customer" and w.u["lead"]["role"] == "contractor"
    bad = await w.call(None, "POST", "/auth/sms/verify",
                       {"phone": "+79001110099", "code": "000000", "role": "customer"})
    assert bad.status_code in (400, 401, 403)
    for who in ("cust", "lead"):
        r = await w.call(who, "GET", "/projects", expect=200)
        assert r.json() == []


async def test_02_customer_creates_project(w):
    r = await w.call("cust", "POST", "/projects", {
        "name": "Квартира на Ленина", "address": "Москва, Ленина 1", "renovation_type": "cosmetic",
        "property_type": "apartment", "total_area_sqm": 52, "rooms": ROOMS,
    }, expect=200)
    p = r.json()
    w.s.update(pid=p["id"], stages=p["stages"], rooms=p["rooms"])
    assert p["name"] == "Квартира на Ленина" and p["budget_planned"] > 0
    assert len(p["rooms"]) == 2 and len(p["estimate_lines"]) >= 5
    names = [s["name"] for s in p["stages"]]
    assert {"Демонтаж", "Стены", "Пол"} <= set(names)


async def test_03_contractor_has_no_access_before_assignment(w):
    for method, path, body in (
        ("GET", "", None),
        ("GET", "/work-schedules", None),
        ("GET", "/chats", None),
        ("POST", "/estimate/lines", {"line_type": "work", "name": "X", "unit": "m2",
                                     "quantity_planned": 1, "unit_price": 1}),
    ):
        r = await w.call("lead", method, P(w) + path, body)
        assert r.status_code in (403, 404), (path, r.status_code, r.text[:200])


async def test_04_contractor_profile_and_catalog(w):
    await w.call("lead", "POST", "/contractors/profile", {
        "company_name": "ИП Подрядов", "specialties": "отделка", "city": "Москва",
        "bio": "10 лет", "payment_requisites": "р/с 40802810000000000001"}, expect=200)
    r = await w.call("cust", "GET", "/contractors", expect=200)
    assert any(c.get("user_id") == w.u["lead"]["id"] or c.get("company_name") == "ИП Подрядов"
               for c in r.json())


# ---------------------------------------------------------------- 2. назначение исполнителя (JRN-001)

async def test_05_foreign_contractor_claim_needs_customer_confirmation(w):
    """JRN-001: самозаявка = заявка pending (202), исполнителем не становится."""
    r = await w.call("other", "POST", f"{P(w)}/assign", expect=202)
    assert r.json()["status"] == "pending_customer_confirmation"
    assert r.json()["request"]["status"] == "pending"
    w.s["other_req"] = r.json()["request"]["id"]
    assert await lead_id(w, w.s["pid"]) is None
    # чужой без подтверждения проект не видит и писать не может
    assert (await w.call("other", "GET", P(w))).status_code in (403, 404)
    # заказчик получил уведомление о заявке
    r = await w.call("cust", "GET", "/notifications", expect=200)
    assert len(r.json()) >= 1
    # заявки видит заказчик, чужой — нет
    r = await w.call("cust", "GET", f"{P(w)}/assignment-requests", expect=200)
    assert any(i["id"] == w.s["other_req"] for i in r.json()["items"])
    r = await w.call("lead", "GET", f"{P(w)}/assignment-requests")  # другой исполнитель видит только своё
    assert r.status_code in (403, 404) or all(i["id"] != w.s["other_req"] for i in r.json()["items"])


async def test_06_customer_declines_foreign_claim(w):
    r = await w.call("cust", "POST", f"{P(w)}/assignment-requests/{w.s['other_req']}/decline", expect=200)
    assert r.json()["status"] == "declined"
    assert (await w.call("other", "GET", P(w))).status_code in (403, 404)
    assert await lead_id(w, w.s["pid"]) is None


async def test_07_lead_claims_and_customer_accepts(w):
    r = await w.call("lead", "POST", f"{P(w)}/assign", expect=202)
    req = r.json()["request"]["id"]
    r = await w.call("lead", "POST", f"{P(w)}/assign", expect=202)  # повтор идемпотентен
    assert r.json()["request"]["id"] == req
    # исполнитель не может подтвердить сам
    assert (await w.call("lead", "POST", f"{P(w)}/assignment-requests/{req}/accept")).status_code == 403
    assert (await w.call("other", "POST", f"{P(w)}/assignment-requests/{req}/accept")).status_code in (403, 404)
    r = await w.call("cust", "POST", f"{P(w)}/assignment-requests/{req}/accept", expect=200)
    assert r.json()["status"] == "accepted"
    r = await w.call("lead", "GET", P(w), expect=200)
    assert r.json()["access_mode"] == "contractor" and r.json()["read_only"] is False
    assert await lead_id(w, w.s["pid"]) == w.u["lead"]["id"]
    # проект занят: чужой не может ни заявиться поверх, ни подключиться
    assert (await w.call("other", "POST", f"{P(w)}/assign")).status_code in (403, 409)
    assert (await w.call("other", "GET", P(w))).status_code in (403, 404)


async def test_08_replacing_contractor_needs_explicit_release(w):
    """JRN-001: подключённого исполнителя другой заявкой/подключением не подменить; снять может только заказчик."""
    b = await new_project(w, "Проект B (замена исполнителя)")
    B = f"/projects/{b['id']}"
    w.s["bid"] = b["id"]
    await connect(w, b["id"], "lead")
    swap = await w.call("cust", "POST", f"{B}/contractor", {"contractor_id": w.u["other"]["id"]})
    assert swap.status_code == 409
    assert (await w.call("other", "POST", f"{B}/assign")).status_code in (403, 409)
    for who in ("lead", "other", "guest"):
        assert (await w.call(who, "DELETE", f"{B}/contractor")).status_code in (403, 404), who


@pytest.mark.xfail(strict=True, reason="JRN-011: этап 1 создаётся уже active, поэтому снять исполнителя сразу после назначения нельзя (contractor_work_started) (волна 2)")
async def test_08b_customer_can_release_and_replace_contractor(w):
    B = f"/projects/{w.s['bid']}"
    await w.call("cust", "DELETE", f"{B}/contractor", expect=200)
    assert (await w.call("lead", "GET", B)).status_code in (403, 404)
    assert await lead_id(w, w.s["bid"]) is None
    await w.call("cust", "POST", f"{B}/contractor", {"contractor_id": w.u["other"]["id"]}, expect=200)
    assert await lead_id(w, w.s["bid"]) == w.u["other"]["id"]


async def test_09_guest_viewer_is_read_only(w):
    await w.call("cust", "POST", f"{P(w)}/viewers", {"profile_code": w.u["guest"]["profile_code"]}, expect=200)
    r = await w.call("guest", "GET", P(w), expect=200)
    assert r.json().get("access_mode") in ("guest", "viewer") or r.json().get("read_only") is True
    for method, path in (("POST", "/estimate/lock"), ("POST", "/archive"), ("POST", "/portal-link")):
        r = await w.call("guest", method, P(w) + path)
        assert r.status_code == 403, (path, r.status_code, r.text[:200])
    r = await w.call("guest", "POST", f"{P(w)}/estimate/lines",
                     {"line_type": "work", "name": "x", "unit": "m2", "quantity_planned": 1, "unit_price": 1})
    assert r.status_code == 403


@pytest.mark.xfail(strict=True, reason="JRN-031: гость видит банковские реквизиты исполнителя (волна 6)")
async def test_09b_guest_does_not_see_payment_requisites(w):
    r = await w.call("guest", "GET", f"{P(w)}/payment-requisites")
    assert r.status_code == 403 or not (r.json() or {}).get("payment_requisites")


# ---------------------------------------------------------------- 3. смета

async def test_10_project_params_roles(w):
    """P0-4/P0-10: параметры и бюджет проекта правит только заказчик; customer_budget виден только ему."""
    r = await w.call("lead", "PATCH", P(w), {"name": "HACK", "vat_rate": 20, "customer_budget": 1})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "customer_only"
    r = await w.call("cust", "PATCH", P(w), {"name": "Квартира на Ленина", "customer_budget": 500000}, expect=200)
    assert r.json()["customer_budget"] == 500000
    r = await w.call("lead", "GET", P(w), expect=200)
    assert r.json()["customer_budget"] is None and r.json()["name"] == "Квартира на Ленина"
    lst = await w.call("lead", "GET", "/projects", expect=200)
    assert all(item["customer_budget"] is None for item in lst.json())
    r = await w.call("cust", "GET", P(w), expect=200)
    assert r.json()["customer_budget"] == 500000


async def test_11_estimate_lines_contractor_writes_customer_reads(w):
    r = await w.call("cust", "GET", P(w), expect=200)
    lines = r.json()["estimate_lines"]
    w.s["lines"] = lines
    room = w.s["rooms"][0]["id"]
    # заказчик сметных строк не создаёт и не правит (вносит их исполнитель)
    assert (await w.call("cust", "POST", f"{P(w)}/estimate/lines", {
        "line_type": "work", "name": "Х", "unit": "m2", "quantity_planned": 1, "unit_price": 1})).status_code == 403
    assert (await w.call("cust", "PATCH", f"{P(w)}/estimate/lines/{lines[0]['id']}", {"unit_price": 1})).status_code == 403
    body = {"line_type": "work", "name": "Штукатурка стен", "unit": "m2", "quantity_planned": 60,
            "unit_price": 450, "room_id": room, "category": "walls", "client_request_id": "line-req-00001"}
    r = await w.call("lead", "POST", f"{P(w)}/estimate/lines", body, expect=200)
    first = r.json()["id"]
    assert r.json()["idempotent_replay"] is False
    r = await w.call("lead", "POST", f"{P(w)}/estimate/lines", body, expect=200)  # идемпотентность
    assert r.json()["id"] == first and r.json()["idempotent_replay"] is True
    r = await w.call("lead", "POST", f"{P(w)}/estimate/lines", {**body, "name": "ДРУГОЕ"})
    assert r.status_code == 409
    await w.call("lead", "POST", f"{P(w)}/estimate/lines", {
        "line_type": "material", "name": "Шпаклёвка Ротбанд 25кг", "unit": "bag",
        "quantity_planned": 12, "unit_price": 780, "category": "walls"}, expect=200)
    await w.call("lead", "PATCH", f"{P(w)}/estimate/lines/{lines[0]['id']}",
                 {"unit_price": 500, "quantity_planned": 2}, expect=200)
    now = (await w.call("cust", "GET", P(w), expect=200)).json()["estimate_lines"]
    patched = [l for l in now if l["id"] == lines[0]["id"]][0]
    assert float(patched["unit_price"]) == 500 and float(patched["quantity_planned"]) == 2
    assert first in [l["id"] for l in now]
    zero = await w.call("lead", "POST", f"{P(w)}/estimate/lines", {
        "line_type": "work", "name": "нуль", "unit": "m2", "quantity_planned": 0, "unit_price": 1})
    assert zero.status_code in (400, 422)
    other = await new_project(w, "Проект X (чужие строки)")
    r = await w.call("lead", "PATCH", f"{P(w)}/estimate/lines/{other['estimate_lines'][0]['id']}", {"unit_price": 1})
    assert r.status_code in (403, 404)
    r = await w.call("lead", "POST", f"{P(w)}/estimate/import-csv", {
        "csv_text": "name,unit,quantity,price,type\nГрунтовка,l,30,120,material\n"}, expect=200)


async def test_11b_negative_price_rejected(w):
    lid = w.s["lines"][0]["id"]
    r = await w.call("lead", "PATCH", f"{P(w)}/estimate/lines/{lid}", {"unit_price": -5})
    assert r.status_code == 422  # JRN-014 закрыт (EST-004)


async def test_11c_calc_materials(w):
    rid = w.s["rooms"][0]["id"]
    r = await w.call("lead", "POST", f"{P(w)}/rooms/{rid}/calc-materials")
    assert r.status_code == 200, r.text[:200]
    r = await w.call("cust", "POST", f"{P(w)}/rooms/{rid}/calc-materials")
    assert r.status_code == 200, r.text[:200]

async def test_12_estimate_exports(w):
    for ext in ("csv", "pdf", "xlsx"):
        r = await w.call("cust", "GET", f"{P(w)}/estimate.{ext}", expect=200)
        assert len(r.content) > 50, ext
    await w.call("lead", "GET", f"{P(w)}/estimate/materials-stats", expect=200)
    assert (await w.call("other", "GET", f"{P(w)}/estimate.csv")).status_code in (403, 404)


async def test_13_propose_reject_propose_lock(w):
    # заказчик не фиксирует смету, пока исполнитель не предложил (исполнитель подключён)
    r = await w.call("cust", "POST", f"{P(w)}/estimate/lock")
    assert r.status_code in (400, 409, 422), (r.status_code, r.text[:200])
    assert (await w.call("guest", "POST", f"{P(w)}/estimate/propose-lock")).status_code == 403
    await w.call("lead", "POST", f"{P(w)}/estimate/propose-lock", expect=200)
    await w.call("cust", "GET", f"{P(w)}/estimate/lock-diff", expect=200)
    await w.call("cust", "POST", f"{P(w)}/estimate/reject-lock", {"reason": "Дорого штукатурка"}, expect=200)
    await w.call("lead", "POST", f"{P(w)}/estimate/propose-lock", expect=200)
    r = await w.call("cust", "GET", P(w), expect=200)
    w.s["budget_before_lock"] = r.json()["budget_planned"]
    r = await w.call("cust", "POST", f"{P(w)}/estimate/lock", expect=200)
    assert r.json()["ok"] is True and r.json()["contract"]["document_id"]
    w.s["doc"] = r.json()["contract"]["document_id"]
    await w.call("cust", "POST", f"{P(w)}/estimate/lock", expect=(200, 409))  # повтор не ломает
    r = await w.call("cust", "GET", P(w), expect=200)
    assert r.json()["estimate_locked_at"]
    w.s["stages"] = r.json()["stages"]


async def test_14_estimate_frozen_after_lock(w):
    """P0-9: после фиксации смета не меняется ни строкой, ни правкой комнаты."""
    lid = w.s["lines"][2]["id"]
    r = await w.call("lead", "PATCH", f"{P(w)}/estimate/lines/{lid}", {"unit_price": 1})
    assert r.status_code in (403, 409)
    before = (await w.call("cust", "GET", P(w), expect=200)).json()
    room = w.s["rooms"][0]["id"]
    await w.call("cust", "PATCH", f"{P(w)}/rooms/{room}", {"area_sqm": 99, "length_m": 11, "width_m": 9})
    after = (await w.call("cust", "GET", P(w), expect=200)).json()
    assert after["budget_planned"] == before["budget_planned"]
    assert [(l["id"], l["total"]) for l in after["estimate_lines"]] == [
        (l["id"], l["total"]) for l in before["estimate_lines"]]


async def test_14b_payment_plan_roles(w):
    """P0-6: суммы этапов (будущие счета) устанавливает заказчик; исполнитель план видит, но не меняет."""
    url = f"{P(w)}/stages/payment-plan"
    plan = (await w.call("lead", "GET", url, expect=200)).json()
    sid = plan["stages"][-1]["id"]
    r = await w.call("lead", "PATCH", url, {"amounts": {sid: 1}})
    assert r.status_code == 403, r.text[:200]
    assert (await w.call("guest", "PATCH", url, {"amounts": {sid: 1}})).status_code == 403
    r = await w.call("cust", "PATCH", url, {"amounts": {sid: plan["total"] * 10}})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "payment_plan_exceeds_total"
    same = {s["id"]: s["payment_amount"] for s in plan["stages"]}
    r = await w.call("cust", "PATCH", url, {"amounts": same}, expect=200)
    after = (await w.call("lead", "GET", url, expect=200)).json()
    assert [s["payment_amount"] for s in after["stages"]] == [s["payment_amount"] for s in plan["stages"]]


# ---------------------------------------------------------------- 4. договор-гейт (JRN-002/012)

async def test_15_contract_is_system_only(w):
    r = await w.call("lead", "POST", f"{P(w)}/documents", {"title": "Мой договор", "document_type": "contract"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "document_type_reserved"
    r = await w.call("cust", "POST", f"{P(w)}/documents", {"title": "Свой договор", "document_type": "contract"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "document_type_reserved"
    r = await w.call("lead", "POST", f"{P(w)}/documents", {"title": "Акт осмотра", "document_type": "act"})
    assert r.status_code == 200
    r = await w.call("cust", "GET", f"{P(w)}/documents", expect=200)
    contracts = [d for d in r.json()["items"] if d.get("kind") == "contract"]
    assert len(contracts) == 1 and contracts[0]["id"] == w.s["doc"]
    for who in ("lead", "cust"):
        await w.call(who, "GET", f"{P(w)}/contract.pdf", expect=200)


async def test_16_gate_closed_until_both_sign(w):
    st = stage_id(w, "Демонтаж")
    r = await w.call("lead", "POST", f"{P(w)}/stages/{st}/start")
    assert r.status_code == 403 and "contract_not_signed" in r.text, r.text[:200]
    r = await w.call("cust", "POST", f"{P(w)}/stages/{st}/start")  # при ведущем исполнителе этап запускает только он
    assert r.status_code == 403
    doc = w.s["doc"]
    for who in ("other", "guest"):
        r = await w.call(who, "POST", f"{P(w)}/documents/{doc}/sign", {"provider": "in_app"})
        assert r.status_code in (403, 404), who
    # внешние провайдеры в dev недоступны
    for prov in ("kontur", "goskey"):
        r = await w.call("lead", "POST", f"{P(w)}/documents/{doc}/sign", {"provider": prov})
        assert r.status_code >= 400, prov
    # подпись ОДНОЙ стороны (исполнитель) не снимает гейт
    await w.call("lead", "POST", f"{P(w)}/documents/{doc}/sign", {"provider": "in_app"}, expect=200)
    r = await w.call("lead", "POST", f"{P(w)}/stages/{st}/start")
    assert r.status_code == 403 and "contract_not_signed" in r.text
    r = await w.call("cust", "GET", f"{P(w)}/contract-gate", expect=200)
    assert r.json()["ok"] is False and r.json()["code"] == "contract_not_signed"
    assert r.json()["reason"] == "awaiting_signatures" and r.json()["document_id"] == doc


async def test_17_signed_version_is_immutable_and_customer_sign_opens_gate(w):
    doc = w.s["doc"]
    await w.call("cust", "POST", f"{P(w)}/documents/{doc}/sign", {"provider": "in_app"}, expect=200)
    await w.call("cust", "POST", f"{P(w)}/documents/{doc}/sign", {"provider": "in_app"}, expect=200)  # идемпотентно
    r = await w.call("cust", "POST", f"{P(w)}/documents/{doc}/versions",
                     {"href": "https://example.test/evil.pdf", "mime_type": "application/pdf"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "signed_document_version_locked"
    r = await w.call("lead", "POST", f"{P(w)}/documents/{doc}/versions",
                     {"href": "https://example.test/evil.pdf", "mime_type": "application/pdf"})
    assert r.status_code == 409
    r = await w.call("cust", "GET", f"{P(w)}/contract-gate", expect=200)
    assert r.json()["ok"] is True, r.text[:300]


async def test_18_gate_side_projects(w):
    """Одна подпись заказчика и отсутствие договора не снимают гейт (SIDE-T / SIDE-U)."""
    t = await new_project(w, "Проект T")
    T = f"/projects/{t['id']}"
    await connect(w, t["id"], "lead")
    await w.call("lead", "POST", f"{T}/estimate/propose-lock", expect=200)
    r = await w.call("cust", "POST", f"{T}/estimate/lock", expect=200)
    doc = r.json()["contract"]["document_id"]
    await w.call("cust", "POST", f"{T}/documents/{doc}/sign", {"provider": "in_app"}, expect=200)
    sid = t["stages"][1]["id"]
    r = await w.call("lead", "POST", f"{T}/stages/{sid}/start")
    assert r.status_code == 403 and "contract_not_signed" in r.text
    # SIDE-U: исполнитель подключён, договора нет вообще
    u = await new_project(w, "Проект U")
    U = f"/projects/{u['id']}"
    await connect(w, u["id"], "lead")
    r = await w.call("lead", "POST", f"{U}/stages/{u['stages'][1]['id']}/start")
    assert r.status_code == 403


# ---------------------------------------------------------------- 5. график

async def test_19_schedule(w):
    r = await w.call("cust", "GET", P(w), expect=200)
    stages = w.s["stages"] = r.json()["stages"]
    assert (await w.call("cust", "POST", f"{P(w)}/work-schedules", {"title": "Мой", "items": []})).status_code == 403
    assert (await w.call("other", "POST", f"{P(w)}/work-schedules", {"title": "Чужой", "items": []})).status_code in (403, 404)
    r = await w.call("lead", "POST", f"{P(w)}/work-schedules",
                     {"title": "План-график работ", "items": [], "client_request_id": "sched-req-0001"}, expect=200)
    sch = r.json()
    w.s["sch"] = sch["id"]
    assert sch["status"] == "draft" and len(sch["items"]) >= 3
    r = await w.call("lead", "POST", f"{P(w)}/work-schedules",
                     {"title": "План-график работ", "items": [], "client_request_id": "sched-req-0001"}, expect=200)
    assert r.json()["id"] == sch["id"]
    bad = [{"stage_id": s["id"], "title": s["name"], "planned_start_date": "2026-10-10",
            "planned_finish_date": "2026-10-05", "sort_order": i} for i, s in enumerate(stages[:2])]
    w.s["bad_dates_status"] = (await w.call("lead", "PUT", f"{P(w)}/work-schedules/{sch['id']}", {"items": bad})).status_code
    items = [{"stage_id": s["id"], "title": s["name"], "planned_start_date": "2026-10-05",
              "planned_finish_date": "2026-10-12", "sort_order": i} for i, s in enumerate(stages[:3])]
    r = await w.call("lead", "PUT", f"{P(w)}/work-schedules/{sch['id']}", {"items": items}, expect=200)
    w.s["sch_items"] = r.json()["items"]
    # черновик заказчик подтвердить не может
    assert (await w.call("cust", "POST", f"{P(w)}/work-schedules/{sch['id']}/confirm")).status_code in (400, 403, 409)
    await w.call("lead", "POST", f"{P(w)}/work-schedules/{sch['id']}/submit", expect=200)
    r = await w.call("lead", "PUT", f"{P(w)}/work-schedules/{sch['id']}", {"title": "после отправки"})
    assert r.status_code == 409
    for who in ("lead", "guest"):
        assert (await w.call(who, "POST", f"{P(w)}/work-schedules/{sch['id']}/confirm")).status_code in (403, 409)
    await w.call("cust", "POST", f"{P(w)}/work-schedules/{sch['id']}/reject", {"reason": "Слишком поздно"}, expect=200)
    await w.call("lead", "POST", f"{P(w)}/work-schedules/{sch['id']}/submit", expect=200)
    r = await w.call("cust", "POST", f"{P(w)}/work-schedules/{sch['id']}/confirm", expect=200)
    assert r.json()["status"] == "confirmed"


@pytest.mark.xfail(strict=True, reason="JRN-015: в графике finish<start принимается (PUT вернул 200) (волна 2)")
async def test_19b_schedule_rejects_finish_before_start(w):
    assert w.s["bad_dates_status"] in (400, 409, 422)


@pytest.mark.xfail(strict=True, reason="STG-007/JRN-015: подтверждённый график терминален, пересогласования нет (волна 2)")
async def test_19c_confirmed_schedule_can_be_renegotiated(w):
    r = await w.call("lead", "PUT", f"{P(w)}/work-schedules/{w.s['sch']}", {"title": "после confirm"})
    assert r.status_code == 200, r.text[:200]


# ---------------------------------------------------------------- 6. старт этапа и работа

async def test_20_start_stage(w):
    st = stage_id(w, "Демонтаж")
    for who in ("other", "guest", "cust"):
        r = await w.call(who, "POST", f"{P(w)}/stages/{st}/start")
        assert r.status_code == 403, (who, r.status_code, r.text[:200])
    r = await w.call("lead", "POST", f"{P(w)}/stages/{st}/start", expect=200)
    assert r.json()["status"] == "active"
    r = await w.call("lead", "POST", f"{P(w)}/stages/{st}/start", expect=200)  # идемпотентно
    assert r.json()["status"] == "active"
    assert (await w.call("lead", "POST", f"{P(w)}/stages/does-not-exist/start")).status_code == 404


async def test_21_execute_stage(w):
    st = stage_id(w, "Демонтаж")
    wf = (await w.call("lead", "GET", f"{P(w)}/stages/{st}/workflow", expect=200)).json()
    cl = wf["checklist"]
    assert cl, "у этапа есть чек-лист"
    r = await w.call("lead", "POST", f"{P(w)}/stages/{st}/submit")
    assert r.status_code in (400, 409, 422), "сдать этап с пустым чек-листом нельзя"
    for who in ("guest", "other"):
        r = await w.call(who, "POST", f"{P(w)}/stages/{st}/checklist/toggle", {"item_id": cl[0]["id"], "done": True})
        assert r.status_code in (403, 404), who
    for it in cl:
        await w.call("lead", "POST", f"{P(w)}/stages/{st}/checklist/toggle",
                     {"item_id": it["id"], "done": True}, expect=200)
    await w.call("lead", "POST", f"{P(w)}/stages/{st}/photos", {"image_data": PNG, "caption": "Результат: демонтаж"}, expect=200)
    assert (await w.call("guest", "POST", f"{P(w)}/stages/{st}/photos", {"image_data": PNG, "caption": "гость"})).status_code == 403
    await w.call("lead", "POST", f"{P(w)}/stages/{st}/comments", {"text": "Стяжку сняли"}, expect=200)
    await w.call("cust", "POST", f"{P(w)}/stages/{st}/comments", {"text": "Принято"}, expect=200)
    assert (await w.call("guest", "POST", f"{P(w)}/stages/{st}/comments", {"text": "гость"})).status_code == 403
    r = await w.call("cust", "GET", f"{P(w)}/stages/{st}", expect=200)
    assert {c["text"] for c in r.json()["comments"]} >= {"Стяжку сняли", "Принято"}
    r = await w.call("cust", "POST", f"{P(w)}/issues", {
        "title": "Трещина в стене", "description": "справа от окна", "stage_id": st,
        "severity": "medium", "client_request_id": "issue-req-0001"}, expect=200)
    w.s["issue"] = r.json()["id"]
    r = await w.call("cust", "POST", f"{P(w)}/issues", {
        "title": "Трещина в стене", "description": "справа от окна", "stage_id": st,
        "severity": "medium", "client_request_id": "issue-req-0001"}, expect=200)
    assert r.json()["id"] == w.s["issue"]
    r = await w.call("cust", "POST", f"{P(w)}/chats", {"title": "Общий чат", "topic": "general"}, expect=200)
    w.s["thread"] = r.json()["id"]
    await w.call("cust", "POST", f"{P(w)}/chats/{w.s['thread']}/messages",
                 {"client_request_id": "msg-req-00001", "text": "Когда начнёте?"}, expect=200)
    await w.call("lead", "POST", f"{P(w)}/chats/{w.s['thread']}/messages",
                 {"client_request_id": "msg-req-00002", "text": "Завтра в 9"}, expect=200)
    assert (await w.call("other", "GET", f"{P(w)}/chats/{w.s['thread']}")).status_code in (403, 404)


# ---------------------------------------------------------------- 7. сдача и приёмка

async def test_22_submit_return_resubmit_accept(w):
    st = stage_id(w, "Демонтаж")
    r = await w.call("lead", "POST", f"{P(w)}/stages/{st}/submit", expect=200)
    acc = r.json()["acceptance_id"]
    assert acc
    r = await w.call("lead", "POST", f"{P(w)}/stages/{st}/submit", expect=200)  # идемпотентно
    assert r.json()["acceptance_id"] == acc
    r = await w.call("cust", "GET", f"{P(w)}/work-acceptances", expect=200)
    assert any(a["id"] == acc for a in (r.json() if isinstance(r.json(), list) else r.json()["items"]))
    for who in ("lead", "other", "guest"):
        r = await w.call(who, "POST", f"{P(w)}/work-acceptances/{acc}/accept", {"quality_score": 10})
        assert r.status_code in (403, 404), who
    assert (await w.call("cust", "POST", f"{P(w)}/work-acceptances/{acc}/return", {})).status_code in (400, 422)
    await w.call("cust", "POST", f"{P(w)}/work-acceptances/{acc}/return",
                 {"comment": "Не вывезен мусор", "create_issue": True}, expect=200)
    r = await w.call("lead", "GET", f"{P(w)}/stages/{st}", expect=200)
    assert r.json()["status"] != "done"
    wf = (await w.call("lead", "GET", f"{P(w)}/stages/{st}/workflow", expect=200)).json()
    for it in wf["checklist"]:
        if not it["done"]:
            await w.call("lead", "POST", f"{P(w)}/stages/{st}/checklist/toggle",
                         {"item_id": it["id"], "done": True}, expect=200)
    r = await w.call("lead", "POST", f"{P(w)}/stages/{st}/submit", expect=200)
    acc2 = r.json()["acceptance_id"]
    assert acc2
    w.s["acc_id_reused"] = acc2 == acc
    r = await w.call("cust", "POST", f"{P(w)}/work-acceptances/{acc2}/accept", {"quality_score": 9, "comment": "ок"}, expect=200)
    assert r.json()["payment_id"], "приёмка порождает платёж за этап"
    w.s["pay"] = r.json()["payment_id"]
    w.s["acc2"] = acc2
    r = await w.call("cust", "POST", f"{P(w)}/work-acceptances/{acc2}/accept", {"quality_score": 9}, expect=200)  # replay
    r = await w.call("cust", "GET", P(w), expect=200)
    done = [s for s in r.json()["stages"] if s["status"] == "done"]
    assert [s["name"] for s in done] == ["Демонтаж"]


@pytest.mark.xfail(strict=True, reason="JRN-029: повторная сдача после возврата переиспользует acceptance_id (волна 2)")
async def test_22a_resubmit_creates_new_acceptance(w):
    assert w.s["acc_id_reused"] is False


@pytest.mark.xfail(strict=True, reason="JRN-018: ProjectOut.progress_percent = 0 при принятом этапе, dashboard иначе (волна 2)")
async def test_22b_progress_consistent(w):
    detail = (await w.call("cust", "GET", P(w), expect=200)).json()["progress_percent"]
    dash = (await w.call("cust", "GET", f"{P(w)}/dashboard", expect=200)).json()["progress_percent"]
    assert detail > 0 and abs(detail - dash) < 1


# ---------------------------------------------------------------- 8. счета и оплата

async def test_23_payments_roles(w):
    r = await w.call("cust", "GET", f"{P(w)}/payments", expect=200)
    pays = r.json()
    assert len(pays) == 1 and pays[0]["id"] == w.s["pay"] and pays[0]["status"] == "pending"
    assert float(pays[0]["amount"]) > 0
    st = stage_id(w, "Демонтаж")
    # заказчик не выставляет счёт на этап; исполнитель — авансы
    r = await w.call("cust", "POST", f"{P(w)}/payments",
                     {"title": "x", "payment_type": "stage", "stage_id": st, "amount": 1})
    assert r.status_code in (400, 403, 409, 422)
    r = await w.call("lead", "POST", f"{P(w)}/payments", {"title": "x", "payment_type": "advance", "amount": 1})
    assert r.status_code in (400, 403, 409, 422)
    # исполнитель/гость/чужой не подтверждают
    for who in ("lead", "guest", "other"):
        r = await w.call(who, "POST", f"{P(w)}/payments/{w.s['pay']}/confirm", {"transfer_ack": True})
        assert r.status_code in (403, 404), who
    # подтверждение без перевода/чека отклоняется
    r = await w.call("cust", "POST", f"{P(w)}/payments/{w.s['pay']}/confirm", {})
    assert r.status_code in (400, 409, 422)


async def test_24_invoice_from_chat_and_unaccepted_stage_payment(w):
    r = await w.call("lead", "POST", f"{P(w)}/chats/{w.s['thread']}/invoice", {
        "title": "Счёт из чата", "amount": 5000, "payment_type": "stage", "client_request_id": "inv-req-0001"}, expect=200)
    w.s["chatpay"] = None
    pays = (await w.call("cust", "GET", f"{P(w)}/payments", expect=200)).json()
    chat = [p for p in pays if p["title"] == "Счёт из чата"]
    assert len(chat) == 1 and float(chat[0]["amount"]) == 5000
    w.s["chatpay"] = chat[0]["id"]
    # оплата этапа, который ещё не принят
    walls = stage_id(w, "Стены")
    r = await w.call("lead", "POST", f"{P(w)}/payments",
                     {"title": "Счёт: Стены", "payment_type": "stage", "stage_id": walls, "percent": 100})
    assert r.status_code == 200, r.text[:200]  # счёт выставить можно, а вот оплатить до приёмки — нет
    r = await w.call("cust", "POST", f"{P(w)}/payments/{r.json()['id']}/confirm", {"transfer_ack": True})
    assert r.status_code == 409, "оплата без приёмки этапа запрещена"


async def test_25_confirm_payment_with_transfer_ack(w):
    pay = w.s["pay"]
    r = await w.call("cust", "POST", f"{P(w)}/payments/{pay}/confirm", {"transfer_ack": True}, expect=200)
    assert r.json()["status"] in ("confirmed", "paid_unverified", "paid")
    w.s["pay_status"] = r.json()["status"]
    r = await w.call("cust", "POST", f"{P(w)}/payments/{pay}/confirm", {"transfer_ack": True}, expect=200)  # повтор
    for who in ("cust", "lead"):
        r = await w.call(who, "GET", f"{P(w)}/payments", expect=200)
        assert any(p["id"] == pay and p["status"] == w.s["pay_status"] for p in r.json())


@pytest.mark.xfail(strict=True, reason="JRN-006: платёж за этап не попадает в budget_spent (волна 1)")
async def test_25b_stage_payment_counts_in_budget_spent(w):
    pay = next(p for p in (await w.call("cust", "GET", f"{P(w)}/payments", expect=200)).json() if p["id"] == w.s["pay"])
    amount = float(pay["amount"])
    detail = (await w.call("cust", "GET", P(w), expect=200)).json()["budget_spent"]
    summary = (await w.call("cust", "GET", f"{P(w)}/budget-summary", expect=200)).json()["summary"]["budget_spent"]
    assert float(detail) >= amount and float(summary) >= amount


QR_1RUB = "t=20260927T1200&s=1.00&fn=9999078901234568&i=12346&fp=1234567891&n=1"


async def test_25c_contractor_cannot_attach_receipt_to_invoice(w):
    """JRN-007: чек к счёту прикладывает только плательщик, получатель подделать доказательство не может."""
    r = await w.call("lead", "POST", f"{P(w)}/receipts/scan", {
        "payment_id": w.s["chatpay"], "qr_raw": QR_1RUB, "client_request_id": "rcpt-req-0002"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "receipt_payment_customer_only"


async def test_25d_receipt_amount_must_match_invoice(w):
    """MNY-002: чек на 1 ₽ не подтверждает счёт на 5000 ₽."""
    await w.call("cust", "POST", f"{P(w)}/receipts/scan", {
        "payment_id": w.s["chatpay"], "qr_raw": QR_1RUB, "client_request_id": "rcpt-req-0003"}, expect=200)
    r = await w.call("cust", "POST", f"{P(w)}/payments/{w.s['chatpay']}/confirm", {})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "receipt_amount_below_invoice"


async def test_25e_customer_opens_dispute_on_confirmed_payment(w):
    pay = w.s["pay"]
    assert (await w.call("lead", "POST", f"{P(w)}/payments/{pay}/dispute",
                         {"reason": "Подрядчик оспаривает платёж заказчика"})).status_code == 403
    r = await w.call("cust", "POST", f"{P(w)}/payments/{pay}/dispute",
                     {"reason": "Оплатил, а акт не подписан по факту"}, expect=200)
    assert r.json()["changed"] is True and r.json()["payment"]["id"] == pay
    r = await w.call("cust", "POST", f"{P(w)}/payments/{pay}/dispute",
                     {"reason": "Оплатил, а акт не подписан по факту"}, expect=(200, 409))


@pytest.mark.xfail(strict=True, reason="JRN-020: спор по платежу закрывает только заказчик, у исполнителя нет права ответа (волна 1)")
async def test_25f_contractor_can_answer_dispute(w):
    r = await w.call("lead", "POST", f"{P(w)}/payments/{w.s['pay']}/dispute/resolve",
                     {"note": "Акт подписан, работы выполнены"})
    assert r.status_code == 200, r.text[:200]


async def test_25g_customer_resolves_dispute(w):
    r = await w.call("cust", "POST", f"{P(w)}/payments/{w.s['pay']}/dispute/resolve",
                     {"note": "Вопрос урегулирован, акт подписан"}, expect=(200, 409))
    if r.status_code == 200:
        assert r.json()["payment"]["id"] == w.s["pay"]


async def test_25h_budget_spent_consistent_after_dispute(w):
    """JRN-019 закрыт: после спора все представления показывают одну и ту же сумму (без удвоения)."""
    detail = (await w.call("cust", "GET", P(w), expect=200)).json()["budget_spent"]
    summary = (await w.call("cust", "GET", f"{P(w)}/budget-summary", expect=200)).json()["summary"]["budget_spent"]
    dash = (await w.call("cust", "GET", f"{P(w)}/dashboard", expect=200)).json()["budget_spent"]
    os_budget = (await w.call("cust", "GET", f"{P(w)}/os/budget", expect=200)).json()["budget_spent"]
    assert float(detail) == float(summary) == float(dash) == float(os_budget)


# ---------------------------------------------------------------- 9. допработы

async def test_26_change_order_creation_roles(w):
    for who in ("cust", "guest", "other"):
        r = await w.call(who, "POST", f"{P(w)}/change-orders", {"title": "Тёплый пол", "amount": 30000})
        assert r.status_code in (403, 404), who
    body = {"title": "Тёплый пол", "amount": 30000, "description": "электрический", "client_request_id": "co-req-00001"}
    r = await w.call("lead", "POST", f"{P(w)}/change-orders", body, expect=200)
    w.s["co"] = r.json()["id"]
    r = await w.call("lead", "POST", f"{P(w)}/change-orders", body, expect=200)
    assert r.json()["id"] == w.s["co"]
    r = await w.call("lead", "POST", f"{P(w)}/change-orders", {"title": "Нулевой", "amount": 0})
    assert r.status_code in (400, 422)
    r = await w.call("cust", "GET", f"{P(w)}/change-orders", expect=200)
    assert any(c["id"] == w.s["co"] and c["status"] == "pending" for c in r.json())
    for who in ("lead", "guest", "other"):
        r = await w.call(who, "POST", f"{P(w)}/change-orders/{w.s['co']}/approve")
        assert r.status_code in (403, 404), who


async def test_27_change_order_approve(w):
    """JRN-004: первое согласование допработ заказчиком — 200, статус approved; повтор идемпотентен."""
    r = await w.call("cust", "POST", f"{P(w)}/change-orders/{w.s['co']}/approve")
    assert r.status_code == 200, r.text[:300]
    r = await w.call("cust", "POST", f"{P(w)}/change-orders/{w.s['co']}/approve")
    assert r.status_code == 200, r.text[:300]
    r = await w.call("cust", "GET", f"{P(w)}/change-orders", expect=200)
    assert [c for c in r.json() if c["id"] == w.s["co"]][0]["status"] == "approved"


async def test_28_change_order_document_is_signable_addendum(w):
    """DOC-006 / волна 0: документ допработ — addendum с содержимым; подпись обеими сторонами."""
    docs = (await w.call("cust", "GET", f"{P(w)}/documents", expect=200)).json()["items"]
    addenda = [d for d in docs if d.get("document_type") == "addendum" or "Доп" in (d.get("title") or "")]
    assert addenda, [d.get("title") for d in docs]
    doc = addenda[0]["id"]
    await w.call("cust", "POST", f"{P(w)}/documents/{doc}/sign", {"provider": "in_app"}, expect=200)
    await w.call("lead", "POST", f"{P(w)}/documents/{doc}/sign", {"provider": "in_app"}, expect=200)


async def test_29_change_order_reject(w):
    r = await w.call("lead", "POST", f"{P(w)}/change-orders", {"title": "Лишнее", "amount": 5000}, expect=200)
    co2 = r.json()["id"]
    await w.call("cust", "POST", f"{P(w)}/change-orders/{co2}/reject", expect=200)
    await w.call("cust", "POST", f"{P(w)}/change-orders/{co2}/reject", expect=(200, 409))
    r = await w.call("cust", "POST", f"{P(w)}/change-orders/{co2}/approve")
    assert r.status_code == 409, "отклонённую допработу согласовать нельзя"


# ---------------------------------------------------------------- 10. закупка

async def test_30_procurement(w):
    r = await w.call("lead", "POST", f"{P(w)}/material-needs/from-estimate", {"client_request_id": "needs-req-0001"}, expect=200)
    picks = (await w.call("cust", "GET", f"{P(w)}/material-picks", expect=200)).json()
    assert isinstance(picks, list)
    assert (await w.call("guest", "POST", f"{P(w)}/material-picks", {"name": "гость", "qty": 1})).status_code == 403
    assert (await w.call("other", "GET", f"{P(w)}/material-picks")).status_code in (403, 404)
    r = await w.call("lead", "POST", f"{P(w)}/material-picks", {
        "name": "Ротбанд 30кг", "qty": 10, "unit": "меш", "price": 800, "shop_name": "Леруа",
        "client_request_id": "pick-req-00001"}, expect=200)
    pk = r.json()["id"]
    await w.call("lead", "POST", f"{P(w)}/material-picks/{pk}/submit", expect=200)
    r = await w.call("lead", "POST", f"{P(w)}/purchases", {
        "material_pick_ids": [pk], "supplier_name": "Леруа", "client_request_id": "purch-req-0001"})
    assert r.status_code in (400, 409, 422), "закупка до согласования выбора запрещена"
    assert (await w.call("lead", "POST", f"{P(w)}/material-picks/{pk}/approve")).status_code == 403
    await w.call("cust", "POST", f"{P(w)}/material-picks/{pk}/approve", expect=200)
    r = await w.call("lead", "POST", f"{P(w)}/purchases", {
        "material_pick_ids": [pk], "supplier_name": "Леруа", "client_request_id": "purch-req-0002"}, expect=200)
    w.s["purchase"] = r.json()["id"]
    r = await w.call("lead", "POST", f"{P(w)}/purchases", {
        "material_pick_ids": [pk], "supplier_name": "Леруа", "client_request_id": "purch-req-0002"}, expect=200)
    assert r.json()["id"] == w.s["purchase"]
    w.s["pick"] = pk


async def test_31_purchase_status_roles(w):
    """P0-7: «оплачено» подтверждает только заказчик; поставку отмечает исполнитель; гость не трогает."""
    pu = w.s["purchase"]
    url = f"{P(w)}/purchases/{pu}/status"
    r = await w.call("lead", "POST", url, {"status": "paid"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "purchase_transition_skipped"  # нельзя перескочить
    assert (await w.call("guest", "POST", url, {"status": "cancelled"})).status_code == 403
    assert (await w.call("other", "POST", url, {"status": "cancelled"})).status_code in (403, 404)
    for status in ("approved", "ordered"):
        r = await w.call("cust", "POST", url, {"status": status}, expect=200)
        assert r.json()["status"] == status
    r = await w.call("lead", "POST", url, {"status": "paid"})
    assert r.status_code == 403, r.text[:200]  # исполнитель не проводит закупку в «оплачено»
    r = await w.call("cust", "POST", url, {"status": "paid"}, expect=200)
    assert r.json()["status"] == "paid" and r.json()["paid_at"]
    r = await w.call("lead", "POST", url, {"status": "delivered"}, expect=200)
    assert r.json()["status"] == "delivered" and r.json()["delivered_at"]
    r = await w.call("cust", "GET", f"{P(w)}/material-picks", expect=200)
    assert [p for p in r.json() if p["id"] == w.s["pick"]][0]["status"] in ("delivered", "purchased", "approved")


# ---------------------------------------------------------------- 11. портал-токен (P0-1/2)

async def test_32_portal_token_scope(w):
    """P0-1/P0-2: исполнитель выпускает только read-ссылку; токен ограничен своим проектом и scope."""
    for body in ({"allow_accept_stage": True}, {"allow_pay": True}):
        r = await w.call("lead", "POST", f"{P(w)}/portal-link", body)
        assert r.status_code == 403, (body, r.text[:200])
    assert (await w.call("guest", "POST", f"{P(w)}/portal-link")).status_code == 403
    assert (await w.call("other", "POST", f"{P(w)}/portal-link")).status_code in (403, 404)
    lead_link = await w.call("lead", "POST", f"{P(w)}/portal-link", expect=200)
    cust_link = await w.call("cust", "POST", f"{P(w)}/portal-link", expect=200)
    for link in (lead_link, cust_link):
        r = await w.call(None, "POST", "/auth/portal/session", {"token": link.json()["token"]}, expect=200)
        assert r.json()["project_id"] == w.s["pid"] and r.json()["scopes"] == ["read"]
        assert r.json()["read_only"] is True
    portal = {"Authorization": f"Bearer {r.json()['access_token']}"}
    other_pid = (await new_project(w, "Другой проект заказчика"))["id"]
    await w.call(None, "GET", f"/portal/projects/{w.s['pid']}/snapshot", headers=portal, expect=200)
    for method, path in (
        ("GET", f"/portal/projects/{other_pid}/snapshot"),
        ("GET", f"/projects/{other_pid}"),
        ("POST", f"/portal/projects/{other_pid}/estimate/lock"),
        ("POST", f"/portal/projects/{w.s['pid']}/work-acceptances/{w.s['acc2']}/accept"),
        ("POST", f"/portal/projects/{w.s['pid']}/estimate/lock"),
    ):
        r = await w.call(None, method, path, {"token": cust_link.json()["token"]} if method == "POST" else None,
                         headers=portal)
        assert r.status_code in (401, 403, 404), (path, r.status_code, r.text[:200])
    # write-scope ссылку получает только сам заказчик
    r = await w.call("cust", "POST", f"{P(w)}/portal-link", {"allow_accept_stage": True}, expect=200)
    r = await w.call(None, "POST", "/auth/portal/session", {"token": r.json()["token"]}, expect=200)
    assert {"accept_stage", "sign_document"} <= set(r.json()["scopes"])


# ---------------------------------------------------------------- 12. остальные этапы, закрытие

async def test_33_closeout_blocked_while_stages_open(w):
    r = await w.call("cust", "GET", f"{P(w)}/closeout-checklist", expect=200)
    r = await w.call("cust", "POST", f"{P(w)}/closeout")
    assert r.status_code in (400, 409, 422), "closeout при незавершённых этапах запрещён"


async def test_34_finish_remaining_stages(w):
    r = await w.call("cust", "GET", P(w), expect=200)
    stages = sorted(r.json()["stages"], key=lambda s: s["sort_order"])
    for stg in stages:
        if stg["status"] == "done":
            continue
        sid, name = stg["id"], stg["name"]
        cur = (await w.call("cust", "GET", f"{P(w)}/stages/{sid}", expect=200)).json()["status"]
        if cur == "planned":
            await w.call("lead", "POST", f"{P(w)}/stages/{sid}/start", expect=200)
        wf = (await w.call("lead", "GET", f"{P(w)}/stages/{sid}/workflow", expect=200)).json()
        for it in wf.get("checklist", []):
            if not it["done"]:
                await w.call("lead", "POST", f"{P(w)}/stages/{sid}/checklist/toggle",
                             {"item_id": it["id"], "done": True}, expect=200)
        await w.call("lead", "POST", f"{P(w)}/stages/{sid}/photos",
                     {"image_data": PNG, "caption": f"Результат: {name}"}, expect=200)
        r = await w.call("lead", "POST", f"{P(w)}/stages/{sid}/submit", expect=200)
        acc = r.json()["acceptance_id"]
        r = await w.call("cust", "POST", f"{P(w)}/work-acceptances/{acc}/accept", {"quality_score": 8}, expect=200)
    r = await w.call("cust", "GET", P(w), expect=200)
    assert all(s["status"] == "done" for s in r.json()["stages"])


async def test_35_invoice_can_be_cancelled(w):
    pend = [p for p in (await w.call("cust", "GET", f"{P(w)}/payments", expect=200)).json() if p["status"] == "pending"]
    assert pend
    r = await w.call("lead", "POST", f"{P(w)}/payments/{pend[0]['id']}/cancel")
    assert r.status_code == 200, r.text[:200]


@pytest.mark.xfail(strict=True, reason="JRN-008: closeout требует «подтвердить» неоплаченные счета (волна 1)")
async def test_36_closeout_does_not_require_confirming_unpaid(w):
    pend = [p for p in (await w.call("cust", "GET", f"{P(w)}/payments", expect=200)).json() if p["status"] == "pending"]
    assert pend, "в сценарии остаются неоплаченные счета"
    r = await w.call("cust", "POST", f"{P(w)}/closeout")
    assert r.status_code == 200, r.text[:200]


async def test_37_closeout(w):
    """Закрываем проект. Пока JRN-008 не исправлен — подтверждаем оставшиеся счета (единственный путь)."""
    r = await w.call("cust", "GET", P(w), expect=200)
    if not r.json().get("is_archived"):
        for p in (await w.call("cust", "GET", f"{P(w)}/payments", expect=200)).json():
            if p["status"] == "pending":
                await w.call("cust", "POST", f"{P(w)}/payments/{p['id']}/confirm", {"transfer_ack": True}, expect=200)
        r = await w.call("cust", "POST", f"{P(w)}/closeout", expect=200)
    r = await w.call("cust", "GET", P(w), expect=200)
    assert r.json()["is_archived"] is True


@pytest.mark.xfail(strict=True, reason="JRN-027: после closeout проект не заперт — исполнитель создаёт платежи и допработы (волна 2)")
async def test_38_project_locked_after_closeout(w):
    r = await w.call("lead", "POST", f"{P(w)}/payments", {"title": "Постфактум", "payment_type": "material", "amount": 100})
    assert r.status_code in (403, 409)
    r = await w.call("lead", "POST", f"{P(w)}/change-orders", {"title": "Постфактум CO", "amount": 100})
    assert r.status_code in (403, 409)


# ---------------------------------------------------------------- 13. гарантия

async def test_39_warranty(w):
    body = {"title": "Трещина в ламинате", "description": "через 2 недели после сдачи",
            "client_request_id": "warr-req-00001"}
    r = await w.call("cust", "POST", f"{P(w)}/warranty-claims", body, expect=200)
    assert r.json()["post_closeout"] is True and r.json()["idempotent_replay"] is False
    cid = r.json()["issue_id"]
    r = await w.call("cust", "POST", f"{P(w)}/warranty-claims", body, expect=200)
    assert r.json()["issue_id"] == cid and r.json()["idempotent_replay"] is True
    for who in ("guest", "other"):
        r = await w.call(who, "POST", f"{P(w)}/warranty-claims", {"title": "нет", "client_request_id": f"warr-{who}-001"})
        assert r.status_code in (403, 404), who
    r = await w.call("lead", "GET", f"{P(w)}/warranty-claims", expect=200)
    items = r.json() if isinstance(r.json(), list) else r.json()["items"]
    assert any(c["id"] == cid for c in items)
    assert (await w.call("lead", "POST", f"{P(w)}/warranty-claims/{cid}/close")).status_code in (403, 409)
    await w.call("cust", "POST", f"{P(w)}/warranty-claims/{cid}/close", expect=200)


# ---------------------------------------------------------------- 14. корзина и purge (P0-8)

async def test_40_trash_and_purge_protection(w):
    for who in ("lead", "guest", "other"):
        assert (await w.call(who, "POST", f"{P(w)}/trash")).status_code in (403, 404), who
    assert (await w.call("cust", "DELETE", P(w))).status_code in (400, 404, 409), "purge не из корзины"
    await w.call("cust", "POST", f"{P(w)}/trash", expect=200)
    await w.call("cust", "GET", "/projects?bucket=trashed", expect=200)
    r = await w.call("cust", "POST", f"{P(w)}/restore", expect=200)
    assert r.json()["trashed_at"] is None
    await w.call("cust", "POST", f"{P(w)}/trash", expect=200)
    for who in ("lead",):
        assert (await w.call(who, "DELETE", P(w))).status_code in (403, 404)
    # платежи и подписанные документы: purge отказывает
    r = await w.call("cust", "DELETE", P(w))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "financial_history_blocks_purge"
    # чистый проект (без денег и подписей) purge проходит
    clean = await new_project(w, "Пустышка")
    await w.call("cust", "POST", f"/projects/{clean['id']}/trash", expect=200)
    await w.call("cust", "DELETE", f"/projects/{clean['id']}", expect=(200, 204))
    assert (await w.call("cust", "GET", f"/projects/{clean['id']}")).status_code == 404
