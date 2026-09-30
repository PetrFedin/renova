"""Audit-map 13: сквозной сценарий Renova «новые пользователи» — in-process, изолированная SQLite.

Запуск (из каталога backend, НЕ трогает 127.0.0.1:8100 и демо-базу):
    cd backend && .venv/bin/python ../docs/audit-map/journey-script-13.py            # отчёт в stdout + JSON-лог
    cd backend && .venv/bin/python -m pytest ../docs/audit-map/journey-script-13.py -s -p no:cacheprovider

Файл лежит вне backend/tests, поэтому в обычный pytest-сбор не попадает. Продуктовый код не изменяется.

ИСТОРИЧЕСКИЙ АРТЕФАКТ: скрипт документирует дефекты на момент аудита и после волны 0 (самозаявка исполнителя
теперь требует подтверждения заказчика) на шагах 30-32 не проходит. Актуальная регрессия под новые правила —
backend/tests/test_journey_regression.py.
Лог всех вызовов (метод, путь, тело, код, ответ) пишется в $JOURNEY_LOG (по умолчанию /tmp/journey13-log.json).
"""
from __future__ import annotations
import asyncio, base64, json, os, sys, tempfile, logging, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))
from httpx import ASGITransport, AsyncClient

import logging
logging.getLogger('app.server_fault').setLevel(logging.CRITICAL if not os.environ.get('JDEBUG') else logging.ERROR)
LOG: list[dict] = []
STEP = {"n": 0, "label": ""}

async def setup_isolated_db():
    import app.main  # noqa: F401
    tmp = tempfile.mkdtemp(prefix="journey13_")
    url = f"sqlite+aiosqlite:///{tmp}/journey.db"
    os.environ["DATABASE_URL"] = url
    from app.core import config
    config.settings.database_url = url
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.db import session as sess
    sess.engine = create_async_engine(url, echo=False)
    sess.SessionLocal = async_sessionmaker(sess.engine, expire_on_commit=False)
    await sess.init_db()
    return sess

class J:
    def __init__(self, client):
        self.c = client
    def step(self, label):
        STEP["n"] += 1; STEP["label"] = label
        print(f"\n=== STEP {STEP['n']}: {label}")
    async def call(self, who, method, path, headers=None, json_body=None, note="", **kw):
        h = dict(headers or {})
        r = await self.c.request(method, "/api/v1" + path, headers=h, json=json_body, **kw)
        try:
            body = r.json()
        except Exception:
            body = r.text[:200]
        rec = dict(step=STEP["n"], label=STEP["label"], who=who, method=method, path=path,
                   req=json_body, status=r.status_code, resp=body, note=note)
        LOG.append(rec)
        s = json.dumps(body, ensure_ascii=False)
        print(f"  [{who}] {method} {path} {json.dumps(json_body, ensure_ascii=False) if json_body else ''} -> {r.status_code} {s[:300]}")
        return r


C = {}  # context

async def register(j, who, phone, role, name, extra=None):
    r = await j.call(who, "POST", "/auth/sms/send", json_body={"phone": phone})
    code = r.json().get("demo_code")
    body = {"phone": phone, "code": code, "role": role, "full_name": name, **(extra or {})}
    r = await j.call(who, "POST", "/auth/sms/verify", json_body=body)
    u = r.json()
    return u, {"Authorization": f"Bearer {u['access_token']}"}

async def phase1(j):
    j.step("Регистрация заказчика (OTP dev-preview)")
    C["cust"], C["hC"] = await register(j, "customer", "+79001110001", "customer", "Иван Заказчиков")
    j.step("Регистрация исполнителя (OTP dev-preview)")
    C["cont"], C["hK"] = await register(j, "contractor", "+79001110002", "contractor", "Пётр Подрядов")
    j.step("Регистрация третьего лица: чужой исполнитель")
    C["cont2"], C["hK2"] = await register(j, "contractor2", "+79001110003", "contractor", "Чужой Подрядчик")
    j.step("Регистрация четвёртого исполнителя для побочных проверок")
    C["cont3"], C["hK3"] = await register(j, "contractor3", "+79001110005", "contractor", "Третий Подрядчик")
    j.step("Регистрация пятого исполнителя для побочных проверок")
    C["cont4"], C["hK4"] = await register(j, "contractor4", "+79001110006", "contractor", "Четвёртый Подрядчик")
    j.step("Регистрация шестого исполнителя (маркетплейс-путь)")
    C["cont5"], C["hK5"] = await register(j, "contractor5", "+79001110007", "contractor", "Пятый Подрядчик")
    j.step("Регистрация седьмого/восьмого исполнителей (побочные проверки, прораб)")
    C["cont6"], C["hK6"] = await register(j, "contractor6", "+79001110008", "contractor", "Шестой Подрядчик")
    C["cont7"], C["hK7"] = await register(j, "contractor7", "+79001110009", "contractor", "Седьмой Прораб")
    j.step("Регистрация наблюдателя (customer-роль)")
    C["view"], C["hV"] = await register(j, "viewer", "+79001110004", "customer", "Гость Наблюдатель")
    j.step("Регистрация: неверный код")
    await j.call("anon", "POST", "/auth/sms/verify", json_body={"phone": "+79001110099", "code": "000000", "role": "customer"})
    j.step("Регистрация: повторная отправка кода сразу (cooldown)")
    await j.call("anon", "POST", "/auth/sms/send", json_body={"phone": "+79001110001"})
    j.step("Регистрация: /auth/register напрямую")
    await j.call("anon", "POST", "/auth/register", json_body={"phone": "+79001110050", "role": "customer", "full_name": "X"})
    j.step("Пустые списки у новых пользователей")
    await j.call("customer", "GET", "/projects", headers=C["hC"])
    await j.call("contractor", "GET", "/projects", headers=C["hK"])

async def phase2(j):
    j.step("Заказчик создаёт проект")
    r = await j.call("customer", "POST", "/projects", headers=C["hC"], json_body={
        "name": "Квартира на Ленина", "address": "Москва, Ленина 1", "renovation_type": "cosmetic",
        "property_type": "apartment", "total_area_sqm": 52,
        "rooms": [{"name": "Гостиная", "area_sqm": 20, "length_m": 5, "width_m": 4},
                  {"name": "Кухня", "area_sqm": 12, "length_m": 4, "width_m": 3}]})
    p = r.json(); C["pid"] = p["id"]; C["proj"] = p
    print(json.dumps({k: p[k] for k in p if k not in ("rooms","estimate_lines")}, ensure_ascii=False)[:1500])
    C["stages"] = p["stages"]
    print([ (s["id"][:6], s["name"], s["status"], s["payment_amount"]) for s in p["stages"]])
    print("rooms", [(r_["id"][:6], r_["name"]) for r_ in p["rooms"]], "lines", len(p["estimate_lines"]))


async def mkproject(j, name="Проект B", who="customer"):
    r = await j.call("customer", "POST", "/projects", headers=C["hC"], json_body={
        "name": name, "address": "Москва", "renovation_type": "cosmetic", "property_type": "apartment", "total_area_sqm": 30,
        "rooms": [{"name": "Комната", "area_sqm": 15, "length_m": 5, "width_m": 3}]})
    return r.json()

async def phase3(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]
    P = f"/projects/{pid}"
    j.step("ДО подключения: исполнитель пытается открыть проект")
    await j.call("contractor", "GET", P, headers=hK)
    j.step("ДО подключения: исполнитель читает график/чат/материалы")
    await j.call("contractor", "GET", P + "/work-schedules", headers=hK)
    await j.call("contractor", "GET", P + "/chats", headers=hK)
    await j.call("contractor", "GET", P + "/estimate/materials-stats", headers=hK)
    j.step("ДО подключения: исполнитель пишет строку сметы")
    await j.call("contractor", "POST", P + "/estimate/lines", headers=hK, json_body={"line_type": "work", "name": "X", "unit": "m2", "quantity_planned": 1, "unit_price": 1})
    j.step("ДО подключения: заказчик ищет исполнителей (/contractors) — профиля ещё нет")
    await j.call("customer", "GET", "/contractors", headers=hC)
    j.step("ДО подключения: заказчик подключает по profile_code / телефону вместо UUID")
    await j.call("customer", "POST", P + "/participants", headers=hC, json_body={"contractor_id": C["cont"]["profile_code"]})
    await j.call("customer", "POST", P + "/contractor", headers=hC, json_body={"contractor_id": C["cont"]["phone"]})
    j.step("ДО подключения: чат-инвайт по profile_code / teams/invite")
    r = await j.call("customer", "GET", P + "/chats", headers=hC)
    j.step("Исполнитель создаёт публичный профиль")
    await j.call("contractor", "POST", "/contractors/profile", headers=hK, json_body={"company_name": "ИП Подрядов", "specialties": "отделка", "city": "Москва", "bio": "10 лет", "payment_requisites": "р/с 40802810000000000001"})
    await j.call("customer", "GET", "/contractors", headers=hC)
    j.step("Наблюдатель: до шаринга")
    await j.call("viewer", "GET", P, headers=hV)

async def phase3b_hijack(j):
    hC, hK, hK2 = C["hC"], C["hK"], C["hK2"]
    j.step("SIDE-B: заказчик создаёт второй проект (жертва)")
    b = await mkproject(j, "Проект B (жертва самозахвата)")
    B = f"/projects/{b['id']}"; C["bid"] = b["id"]
    j.step("SIDE-B: чужой исполнитель, знающий UUID, самоназначается без ведома заказчика")
    await j.call("contractor2", "POST", B + "/assign", headers=hK2)
    j.step("SIDE-B: заказчик пытается подключить своего исполнителя")
    await j.call("customer", "POST", B + "/contractor", headers=hC, json_body={"contractor_id": C["cont"]["id"]})
    j.step("SIDE-B: заказчик пытается снять самозванца (participants)")
    r = await j.call("customer", "GET", B + "/participants", headers=hC)
    part = r.json()[0]["id"]
    await j.call("customer", "DELETE", B + f"/participants/{part}", headers=hC)
    j.step("SIDE-B: уведомления заказчика о захвате")
    await j.call("customer", "GET", "/notifications", headers=hC)
    j.step("SIDE-B: заказчик удаляет проект B в корзину/purge")
    await j.call("customer", "POST", B + "/trash", headers=hC)

async def phase3c_connect(j):
    pid = C["pid"]; hC = C["hC"]; P = f"/projects/{pid}"
    j.step("Заказчик подключает исполнителя по UUID из /contractors")
    r = await j.call("customer", "GET", "/contractors", headers=hC)
    uid = r.json()[0]["user_id"]
    r = await j.call("customer", "POST", P + "/contractor", headers=hC, json_body={"contractor_id": uid})
    print(sorted(r.json().keys()))
    j.step("ПОСЛЕ подключения: исполнитель открывает проект")
    r = await j.call("contractor", "GET", P, headers=C["hK"])
    print({k: r.json().get(k) for k in ("contractor_id", "access_mode", "read_only", "estimate_locked_at")}, len(r.json().get("estimate_lines", [])))
    j.step("ПОСЛЕ подключения: повтор подключения (идемпотентность)")
    await j.call("customer", "POST", P + "/contractor", headers=hC, json_body={"contractor_id": uid})
    j.step("ПОСЛЕ подключения: чужой исполнитель пытается самоназначиться поверх")
    await j.call("contractor2", "POST", P + "/assign", headers=C["hK2"])
    j.step("ПОСЛЕ подключения: чужой исполнитель читает проект")
    await j.call("contractor2", "GET", P, headers=C["hK2"])
    j.step("ПОСЛЕ подключения: уведомления исполнителя и заказчика")
    await j.call("contractor", "GET", "/notifications", headers=C["hK"])
    await j.call("customer", "GET", "/notifications", headers=hC)
    j.step("Гость: заказчик делится проектом по profile_code, гость читает/пишет")
    r = await j.call("customer", "POST", P + "/viewers", headers=hC, json_body={"profile_code": C["view"]["profile_code"]})
    await j.call("viewer", "GET", P, headers=C["hV"])
    await j.call("viewer", "GET", "/projects", headers=C["hV"])
    await j.call("viewer", "GET", P + "/estimate.csv", headers=C["hV"])
    await j.call("viewer", "GET", P + "/payment-requisites", headers=C["hV"])
    await j.call("viewer", "POST", P + "/portal-link", headers=C["hV"])
    await j.call("viewer", "POST", P + "/estimate/lock", headers=C["hV"])
    await j.call("viewer", "POST", P + "/archive", headers=C["hV"])

async def phase3d_selfmanaged(j):
    hC, hK = C["hC"], C["hK"]
    j.step("SIDE-S: проект без исполнителя — заказчик сам запускает этап (без договора)")
    b = await mkproject(j, "Проект S (без исполнителя)")
    S_ = f"/projects/{b['id']}"; C["sid"] = b["id"]
    st = b["stages"][1]["id"]
    await j.call("customer", "POST", S_ + f"/stages/{st}/start", headers=hC)
    j.step("SIDE-S: заказчик фиксирует смету без исполнителя (unilateral lock) -> создаётся договор без второй стороны")
    await j.call("customer", "POST", S_ + "/estimate/lock", headers=hC)
    r = await j.call("customer", "GET", S_ + "/documents", headers=hC)
    doc = [d for d in r.json()["items"] if d.get("document_type") == "contract" or "Договор" in (d.get("title") or "")]
    print("contracts:", doc)
    j.step("SIDE-S: contract-gate для статуса без договора/после lock")
    await j.call("customer", "GET", S_ + "/contract-gate", headers=hC)
    j.step("SIDE-S: исполнитель подключается ПОСЛЕ lock — что он видит/может")
    await j.call("customer", "POST", S_ + "/contractor", headers=hC, json_body={"contractor_id": C["cont"]["id"]})
    j.step("SIDE-S: то же с исполнителем, у которого свободный слот (cont3)")
    hK = C["hK3"]
    await j.call("customer", "POST", S_ + "/contractor", headers=hC, json_body={"contractor_id": C["cont3"]["id"]})
    await j.call("contractor3", "POST", S_ + "/estimate/lines", headers=hK, json_body={"line_type": "work", "name": "Доп", "unit": "m2", "quantity_planned": 1, "unit_price": 100})
    await j.call("contractor3", "POST", S_ + "/estimate/propose-lock", headers=hK)
    await j.call("contractor3", "GET", S_ + "/documents", headers=hK)


async def phase4_estimate(j):
    pid = C["pid"]; hC, hK, hV = C["hC"], C["hK"], C["hV"]; P = f"/projects/{pid}"
    j.step("Смета: заказчик читает проект (10 автогенерированных строк, бюджет)")
    r = await j.call("customer", "GET", P, headers=hC)
    lines = r.json()["estimate_lines"]; C["lines"] = lines
    print([(l["id"][:6], l["line_type"], l["name"], l["quantity_planned"], l["unit_price"], l["total"], l["category"]) for l in lines])
    print("budget_planned", r.json()["budget_planned"])
    j.step("Смета: заказчик пробует править/создавать строки")
    await j.call("customer", "POST", P + "/estimate/lines", headers=hC, json_body={"line_type": "work", "name": "Х", "unit": "m2", "quantity_planned": 1, "unit_price": 1})
    await j.call("customer", "PATCH", P + f"/estimate/lines/{lines[0]['id']}", headers=hC, json_body={"unit_price": 1})
    j.step("Смета: исполнитель создаёт строки (работа + материал)")
    r = await j.call("contractor", "POST", P + "/estimate/lines", headers=hK, json_body={"line_type": "work", "name": "Штукатурка стен", "unit": "m2", "quantity_planned": 60, "unit_price": 450, "room_id": C["proj"]["rooms"][0]["id"], "category": "walls", "client_request_id": "line-req-00001"})
    C["line_new"] = r.json().get("id")
    j.step("Смета: повтор запроса с тем же client_request_id (идемпотентность)")
    await j.call("contractor", "POST", P + "/estimate/lines", headers=hK, json_body={"line_type": "work", "name": "Штукатурка стен", "unit": "m2", "quantity_planned": 60, "unit_price": 450, "room_id": C["proj"]["rooms"][0]["id"], "category": "walls", "client_request_id": "line-req-00001"})
    j.step("Смета: тот же request_id, другое тело")
    await j.call("contractor", "POST", P + "/estimate/lines", headers=hK, json_body={"line_type": "work", "name": "ДРУГОЕ", "unit": "m2", "quantity_planned": 1, "unit_price": 450, "client_request_id": "line-req-00001"})
    j.step("Смета: материал строкой")
    await j.call("contractor", "POST", P + "/estimate/lines", headers=hK, json_body={"line_type": "material", "name": "Шпаклёвка Ротбанд 25кг", "unit": "bag", "quantity_planned": 12, "unit_price": 780, "category": "walls"})
    j.step("Смета: правка строки исполнителем (цена, кол-во)")
    await j.call("contractor", "PATCH", P + f"/estimate/lines/{lines[0]['id']}", headers=hK, json_body={"unit_price": 500, "quantity_planned": 2})
    j.step("Смета: отрицательные значения / нулевое количество")
    await j.call("contractor", "PATCH", P + f"/estimate/lines/{lines[0]['id']}", headers=hK, json_body={"unit_price": -5})
    await j.call("contractor", "POST", P + "/estimate/lines", headers=hK, json_body={"line_type": "work", "name": "нуль", "unit": "m2", "quantity_planned": 0, "unit_price": 1})
    j.step("Смета: строка из чужого проекта (line_id от проекта S)")
    x = await mkproject(j, "Проект X (чужие строки)")
    await j.call("contractor", "PATCH", P + f"/estimate/lines/{x['estimate_lines'][0]['id']}", headers=hK, json_body={"unit_price": 1})
    j.step("Смета: CSV-импорт")
    await j.call("contractor", "POST", P + "/estimate/import-csv", headers=hK, json_body={"csv_text": "name,unit,quantity,price,type\nГрунтовка,l,30,120,material\n"})
    j.step("Смета: расчёт материалов по комнате (calc-materials) и статистика")
    rid = C["proj"]["rooms"][0]["id"]
    await j.call("contractor", "POST", P + f"/rooms/{rid}/calc-materials", headers=hK)
    await j.call("customer", "POST", P + f"/rooms/{rid}/calc-materials", headers=hC)
    await j.call("contractor", "GET", P + "/estimate/materials-stats", headers=hK)
    j.step("Смета: экспорт csv/pdf/xlsx заказчиком")
    for ext in ("csv", "pdf", "xlsx"):
        await j.call("customer", "GET", P + f"/estimate.{ext}", headers=hC)
    j.step("Смета: заказчик до propose-lock пытается зафиксировать (когда исполнитель подключён)")
    await j.call("customer", "POST", P + "/estimate/lock", headers=hC)
    j.step("Смета: исполнитель propose-lock")
    await j.call("contractor", "POST", P + "/estimate/propose-lock", headers=hK)
    j.step("Смета: после propose исполнитель ещё правит (строка)")
    await j.call("contractor", "PATCH", P + f"/estimate/lines/{lines[1]['id']}", headers=hK, json_body={"unit_price": 999})
    j.step("Смета: заказчик видит diff и отклоняет с причиной")
    await j.call("customer", "GET", P + "/estimate/lock-diff", headers=hC)
    await j.call("customer", "POST", P + "/estimate/reject-lock", headers=hC, json_body={"reason": "Дорого штукатурка"})
    j.step("Смета: исполнитель получил причину отказа? (уведомления/чат)")
    await j.call("contractor", "GET", "/notifications", headers=hK)
    j.step("Смета: повторный propose-lock и lock заказчиком")
    await j.call("contractor", "POST", P + "/estimate/propose-lock", headers=hK)
    await j.call("customer", "POST", P + "/estimate/lock", headers=hC)
    j.step("Смета: повтор lock / правка после lock / propose после lock")
    await j.call("customer", "POST", P + "/estimate/lock", headers=hC)
    await j.call("contractor", "PATCH", P + f"/estimate/lines/{lines[2]['id']}", headers=hK, json_body={"unit_price": 1})
    await j.call("contractor", "POST", P + "/estimate/propose-lock", headers=hK)
    r = await j.call("customer", "GET", P, headers=hC)
    print("budget after lock", r.json()["budget_planned"], [(s_["name"], s_["payment_amount"]) for s_ in r.json()["stages"]])


async def phase5_contract(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"
    r = await j.call("customer", "GET", P, headers=hC)
    C["stages"] = r.json()["stages"]
    st = C["stages"][1]["id"]
    j.step("Договор: contract-gate у исполнителя и заказчика (договор создан при lock)")
    await j.call("contractor", "GET", P + "/contract-gate", headers=hK)
    j.step("Договор: список документов, PDF договора")
    r = await j.call("contractor", "GET", P + "/documents", headers=hK)
    docs = [d for d in r.json()["items"] if d.get("kind") == "contract"]
    C["doc"] = docs[0]["id"]; print(docs[0])
    await j.call("contractor", "GET", P + "/contract.pdf", headers=hK)
    await j.call("customer", "GET", P + "/contract.pdf", headers=hC)
    j.step("Договор: «отправка» — есть ли эндпоинт отправки/уведомление заказчику")
    await j.call("customer", "GET", "/notifications", headers=hC)
    j.step("Гейт: старт этапа исполнителем до подписи")
    await j.call("contractor", "POST", P + f"/stages/{st}/start", headers=hK)
    j.step("Гейт: старт этапа заказчиком до подписи")
    await j.call("customer", "POST", P + f"/stages/{st}/start", headers=hC)
    j.step("Подпись: чужой исполнитель / гость (без доступа)")
    await j.call("contractor2", "POST", P + f"/documents/{C['doc']}/sign", headers=hK2, json_body={"provider": "in_app"})
    await j.call("viewer", "POST", P + f"/documents/{C['doc']}/sign", headers=hV, json_body={"provider": "in_app"})
    j.step("Подпись: внешний провайдер kontur/goskey в dev")
    await j.call("contractor", "POST", P + f"/documents/{C['doc']}/sign", headers=hK, json_body={"provider": "kontur"})
    await j.call("contractor", "POST", P + f"/documents/{C['doc']}/sign", headers=hK, json_body={"provider": "goskey"})
    await j.call("contractor", "GET", "/esign/providers", headers=hK)
    j.step("Подпись: исполнитель подписывает первым (in_app)")
    await j.call("contractor", "POST", P + f"/documents/{C['doc']}/sign", headers=hK, json_body={"provider": "in_app"})
    j.step("Гейт: состояние после подписи ТОЛЬКО исполнителя (заказчик не подписал)")
    await j.call("customer", "GET", P + "/contract-gate", headers=hC)
    r = await j.call("customer", "GET", P + "/documents", headers=hC)
    print([ (d["title"], d["status"], (d.get("meta") or {}).get("signatures")) for d in r.json()["items"] if d.get("kind") == "contract"])
    j.step("Гейт: старт этапа исполнителем при подписи одной стороны")
    await j.call("contractor", "POST", P + f"/stages/{st}/start", headers=hK, note="GATE-ONE-SIDE")


async def phase5b_customer_sign(j):
    pid = C["pid"]; hC, hK = C["hC"], C["hK"]; P = f"/projects/{pid}"
    j.step("Подпись: заказчик подписывает (вторая сторона)")
    await j.call("customer", "POST", P + f"/documents/{C['doc']}/sign", headers=hC, json_body={"provider": "in_app"})
    j.step("Подпись: повторная подпись тем же (идемпотентность)")
    await j.call("customer", "POST", P + f"/documents/{C['doc']}/sign", headers=hC, json_body={"provider": "in_app"})
    await j.call("contractor", "POST", P + f"/documents/{C['doc']}/sign", headers=hK, json_body={"provider": "in_app"})
    j.step("Подпись: итоговое состояние документа/уведомления обеим сторонам")
    r = await j.call("customer", "GET", P + "/documents", headers=hC)
    print([(d["title"], d["status"], [(x["signer_role"], x["status"]) for x in (d.get("meta") or {}).get("signatures", [])]) for d in r.json()["items"] if d.get("kind") == "contract"])
    await j.call("contractor", "GET", "/notifications", headers=hK)

async def phase5c_customer_only_gate(j):
    hC = C["hC"]; hK3 = C["hK6"]
    j.step("SIDE-T: проект с cont3; заказчик подписывает договор ОДИН, исполнитель не подписывал")
    t = await mkproject(j, "Проект T")
    T = f"/projects/{t['id']}"
    await j.call("customer", "POST", T + "/contractor", headers=hC, json_body={"contractor_id": C["cont6"]["id"]})
    await j.call("contractor6", "POST", T + "/estimate/propose-lock", headers=hK3)
    r = await j.call("customer", "POST", T + "/estimate/lock", headers=hC)
    doc = r.json()["contract"]["document_id"]
    await j.call("customer", "POST", T + f"/documents/{doc}/sign", headers=hC, json_body={"provider": "in_app"})
    await j.call("contractor6", "GET", T + "/contract-gate", headers=hK3)
    st = t["stages"][1]["id"]
    await j.call("contractor6", "POST", T + f"/stages/{st}/start", headers=hK3, note="GATE-CUSTOMER-ONLY")

async def phase5d_gate_before_lock(j):
    hC, hK4 = C["hC"], C["hK4"]
    j.step("SIDE-U: гейт до фиксации сметы: исполнитель подключён, договора нет вообще")
    u = await mkproject(j, "Проект U")
    U = f"/projects/{u['id']}"
    await j.call("customer", "POST", U + "/contractor", headers=hC, json_body={"contractor_id": C["cont4"]["id"]})
    await j.call("contractor4", "GET", U + "/contract-gate", headers=hK4)
    st = u["stages"][1]["id"]
    await j.call("contractor4", "POST", U + f"/stages/{st}/start", headers=hK4, note="GATE-NO-CONTRACT")
    print("stage0 status at creation:", u["stages"][0]["status"])

async def phase6_schedule(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"
    r = await j.call("customer", "GET", P, headers=hC); C["stages"] = r.json()["stages"]
    j.step("График: заказчик и чужой исполнитель пытаются создать")
    await j.call("customer", "POST", P + "/work-schedules", headers=hC, json_body={"title": "Мой график", "items": []})
    await j.call("contractor2", "POST", P + "/work-schedules", headers=hK2, json_body={"title": "Чужой", "items": []})
    j.step("График: submit пустого/несуществующего")
    r = await j.call("contractor", "POST", P + "/work-schedules", headers=hK, json_body={"title": "План-график работ", "items": [], "client_request_id": "sched-req-0001"})
    sch = r.json(); C["sch"] = sch["id"]; print("items auto from stages:", len(sch["items"]), sch["status"])
    j.step("График: повтор создания с тем же client_request_id")
    r = await j.call("contractor", "POST", P + "/work-schedules", headers=hK, json_body={"title": "План-график работ", "items": [], "client_request_id": "sched-req-0001"})
    print("same id?", r.json()["id"] == sch["id"])
    j.step("График: до submit заказчик видит его? confirm черновика?")
    await j.call("customer", "GET", P + "/work-schedules", headers=hC)
    await j.call("customer", "GET", P + "/work-schedules/active", headers=hC)
    await j.call("customer", "POST", P + f"/work-schedules/{C['sch']}/confirm", headers=hC)
    j.step("График: правка (PUT) исполнителем — даты позже конца проекта, конец раньше начала")
    items = [{"stage_id": s["id"], "title": s["name"], "planned_start_date": "2026-10-10", "planned_finish_date": "2026-10-05"} for s in C["stages"][:2]]
    await j.call("contractor", "PUT", P + f"/work-schedules/{C['sch']}", headers=hK, json_body={"items": items})
    j.step("График: PUT корректных позиций")
    items = [{"stage_id": s["id"], "title": s["name"], "planned_start_date": "2026-10-05", "planned_finish_date": "2026-10-12", "sort_order": i} for i, s in enumerate(C["stages"][:3])]
    r = await j.call("contractor", "PUT", P + f"/work-schedules/{C['sch']}", headers=hK, json_body={"items": items})
    C["items"] = r.json()["items"]
    j.step("График: submit исполнителем; повтор submit")
    await j.call("contractor", "POST", P + f"/work-schedules/{C['sch']}/submit", headers=hK)
    await j.call("contractor", "POST", P + f"/work-schedules/{C['sch']}/submit", headers=hK)
    j.step("График: правка после submit")
    await j.call("contractor", "PUT", P + f"/work-schedules/{C['sch']}", headers=hK, json_body={"title": "изменён после отправки"})
    j.step("График: подтверждение чужим/исполнителем/гостем")
    await j.call("contractor", "POST", P + f"/work-schedules/{C['sch']}/confirm", headers=hK)
    await j.call("viewer", "POST", P + f"/work-schedules/{C['sch']}/confirm", headers=hV)
    j.step("График: заказчик отклоняет с причиной → исполнитель видит?")
    await j.call("customer", "POST", P + f"/work-schedules/{C['sch']}/reject", headers=hC, json_body={"reason": "Слишком поздно"})
    await j.call("contractor", "GET", "/notifications", headers=hK)
    j.step("График: исполнитель повторно submit → заказчик confirm")
    await j.call("contractor", "POST", P + f"/work-schedules/{C['sch']}/submit", headers=hK)
    r = await j.call("customer", "POST", P + f"/work-schedules/{C['sch']}/confirm", headers=hC)
    print("schedule status", r.json()["status"], r.json()["schedule_version"])
    j.step("График: повторный confirm, правка после confirm, и как изменились этапы")
    await j.call("customer", "POST", P + f"/work-schedules/{C['sch']}/confirm", headers=hC)
    await j.call("contractor", "PUT", P + f"/work-schedules/{C['sch']}", headers=hK, json_body={"title": "после confirm"})
    r = await j.call("customer", "GET", P, headers=hC)
    print([(s["name"], s["planned_start"], s["planned_end"], s["status"]) for s in r.json()["stages"][:4]])
    j.step("График: отметка позиций (статусы)")
    it = C["items"][1]["id"]
    await j.call("contractor", "POST", P + f"/work-schedules/{C['sch']}/items/{it}/status", headers=hK, json_body={"status": "in_progress", "progress_percent": 30})
    await j.call("contractor", "POST", P + f"/work-schedules/{C['sch']}/items/{it}/status", headers=hK, json_body={"status": "accepted"})
    await j.call("customer", "POST", P + f"/work-schedules/{C['sch']}/items/{it}/status", headers=hC, json_body={"status": "accepted"})


import base64
BUDGET_LOG = []
async def bprobe(j, label):
    pid = C["pid"]; hC = C["hC"]; P = f"/projects/{pid}"
    a = (await j.call("customer", "GET", P, headers=hC)).json()["budget_spent"]
    b = (await j.call("customer", "GET", P + "/os/budget", headers=hC)).json()["budget_spent"]
    d = (await j.call("customer", "GET", P + "/dashboard", headers=hC)).json()["budget_spent"]
    m = (await j.call("customer", "GET", P + "/budget-summary", headers=hC)).json()["summary"]["budget_spent"]
    BUDGET_LOG.append((j_step(), label, a, b, d, m)); print("BPROBE", label, "detail", a, "os/budget", b, "dashboard", d, "budget-summary", m)

def j_step():
    return STEP["n"]

PNG = "data:image/png;base64," + base64.b64encode(bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")).decode()

async def phase7_start(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"
    r = await j.call("customer", "GET", P, headers=hC); C["stages"] = r.json()["stages"]
    S = {s["name"]: s["id"] for s in C["stages"]}; C["S"] = S
    print([(s["name"], s["status"]) for s in C["stages"]])
    j.step("Старт этапа: договор подписан обеими; стартуем этап вне очереди «Стены»")
    await j.call("contractor", "GET", P + f"/stages/{S['Стены']}/blocked", headers=hK)
    await j.call("contractor", "POST", P + f"/stages/{S['Стены']}/start", headers=hK)
    j.step("Старт этапа: повтор старта уже активного (идемпотентность)")
    await j.call("contractor", "POST", P + f"/stages/{S['Демонтаж']}/start", headers=hK)
    j.step("Старт этапа: чужой исполнитель / гость / заказчик")
    await j.call("contractor2", "POST", P + f"/stages/{S['Пол']}/start", headers=hK2)
    await j.call("viewer", "POST", P + f"/stages/{S['Пол']}/start", headers=hV)
    await j.call("customer", "POST", P + f"/stages/{S['Пол']}/start", headers=hC)
    j.step("Старт этапа: несуществующий этап / этап другого проекта")
    await j.call("contractor", "POST", P + "/stages/does-not-exist/start", headers=hK)

async def phase8_execute(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"; S = C["S"]
    st = S["Демонтаж"]
    j.step("Выполнение: workflow/чек-лист этапа глазами исполнителя и заказчика")
    r = await j.call("contractor", "GET", P + f"/stages/{st}/workflow", headers=hK)
    cl = r.json().get("checklist") or []; print("checklist:", [(i["id"], i.get("title") or i.get("text"), i.get("done")) for i in cl][:8])
    await j.call("customer", "GET", P + f"/stages/{st}/workflow", headers=hC)
    j.step("Выполнение: completion-check ДО работ (что мешает сдать)")
    await j.call("contractor", "GET", P + f"/stages/{st}/completion-check", headers=hK)
    j.step("Выполнение: попытка сдать сразу (submit)")
    await j.call("contractor", "POST", P + f"/stages/{st}/submit", headers=hK)
    j.step("Выполнение: чек-лист — заказчик/гость/чужой отмечают; исполнитель отмечает")
    if cl:
        await j.call("customer", "POST", P + f"/stages/{st}/checklist/toggle", headers=hC, json_body={"item_id": cl[0]["id"], "done": True})
        await j.call("viewer", "POST", P + f"/stages/{st}/checklist/toggle", headers=hV, json_body={"item_id": cl[0]["id"], "done": True})
        await j.call("contractor2", "POST", P + f"/stages/{st}/checklist/toggle", headers=hK2, json_body={"item_id": cl[0]["id"], "done": True})
        for it in cl:
            await j.call("contractor", "POST", P + f"/stages/{st}/checklist/toggle", headers=hK, json_body={"item_id": it["id"], "done": True})
    j.step("Выполнение: completion-check после чек-листа (нужны фото?)")
    await j.call("contractor", "GET", P + f"/stages/{st}/completion-check", headers=hK)
    j.step("Выполнение: фото результата")
    await j.call("contractor", "POST", P + f"/stages/{st}/photos", headers=hK, json_body={"image_data": PNG, "caption": "Демонтаж завершён"})
    await j.call("customer", "POST", P + f"/stages/{st}/photos", headers=hC, json_body={"image_data": PNG, "caption": "фото заказчика"})
    await j.call("viewer", "POST", P + f"/stages/{st}/photos", headers=hV, json_body={"image_data": PNG, "caption": "гость"})
    j.step("Выполнение: комментарии к этапу (исполнитель, заказчик, гость), проверка что видит другая роль")
    await j.call("contractor", "POST", P + f"/stages/{st}/comments", headers=hK, json_body={"text": "Стяжку сняли, нужны контейнеры"})
    await j.call("customer", "POST", P + f"/stages/{st}/comments", headers=hC, json_body={"text": "Принято, жду фото"})
    await j.call("viewer", "POST", P + f"/stages/{st}/comments", headers=hV, json_body={"text": "гость пишет"})
    r = await j.call("customer", "GET", P + f"/stages/{st}", headers=hC)
    print("stage keys", sorted(r.json().keys())); print("comments seen by customer:", [(c.get("text")) for c in r.json().get("comments", [])])
    r = await j.call("contractor", "GET", P + f"/stages/{st}", headers=hK)
    print("comments seen by contractor:", [(c.get("text")) for c in r.json().get("comments", [])])
    j.step("Выполнение: замечание (issue) заказчиком и исполнителем")
    r = await j.call("customer", "POST", P + "/issues", headers=hC, json_body={"title": "Трещина в стене", "description": "справа от окна", "stage_id": st, "severity": "medium", "client_request_id": "issue-req-0001"})
    C["issue"] = r.json().get("id")
    await j.call("customer", "POST", P + "/issues", headers=hC, json_body={"title": "Трещина в стене", "description": "справа от окна", "stage_id": st, "severity": "medium", "client_request_id": "issue-req-0001"})
    await j.call("contractor", "GET", P + "/issues", headers=hK)
    await j.call("viewer", "POST", P + "/issues", headers=hV, json_body={"title": "гость создаёт", "severity": "low"})
    j.step("Выполнение: чат — тред, сообщение, чтение другой стороной")
    r = await j.call("customer", "POST", P + "/chats", headers=hC, json_body={"title": "Общий чат", "topic": "general"})
    C["thread"] = r.json().get("id")
    await j.call("customer", "POST", P + f"/chats/{C['thread']}/messages", headers=hC, json_body={"client_request_id": "msg-req-00001", "text": "Добрый день, когда начнёте?"})
    await j.call("contractor", "GET", P + "/chats", headers=hK)
    await j.call("contractor", "GET", P + f"/chats/{C['thread']}", headers=hK)
    await j.call("contractor", "POST", P + f"/chats/{C['thread']}/messages", headers=hK, json_body={"client_request_id": "msg-req-00002", "text": "Завтра в 9"})
    await j.call("customer", "GET", "/chats/unread-total", headers=hC)
    await j.call("contractor2", "GET", P + f"/chats/{C['thread']}", headers=hK2)
    await j.call("viewer", "POST", P + f"/chats/{C['thread']}/messages", headers=hV, json_body={"client_request_id": "msg-req-00003", "text": "гость пишет в чат"})


async def phase9_acceptance(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"; S = C["S"]
    st = S["Демонтаж"]
    j.step("Сдача: исполнитель сдаёт этап (submit)")
    r = await j.call("contractor", "POST", P + f"/stages/{st}/submit", headers=hK)
    acc = r.json().get("acceptance_id"); C["acc"] = acc
    j.step("Сдача: повтор submit (идемпотентность)")
    await j.call("contractor", "POST", P + f"/stages/{st}/submit", headers=hK)
    j.step("Сдача: редактирование чек-листа/фото/комментария после сдачи")
    await j.call("contractor", "POST", P + f"/stages/{st}/checklist/toggle", headers=hK, json_body={"item_id": "c4", "done": False})
    await j.call("contractor", "POST", P + f"/stages/{st}/photos", headers=hK, json_body={"image_data": PNG, "caption": "ещё"})
    j.step("Сдача: что видит заказчик (acceptances, pending-count, уведомления)")
    await j.call("customer", "GET", P + "/work-acceptances", headers=hC)
    await j.call("customer", "GET", P + "/work-acceptances/pending-count", headers=hC)
    await j.call("customer", "GET", "/notifications", headers=hC)
    j.step("Приёмка: исполнитель / чужой / гость пытаются принять")
    await j.call("contractor", "POST", P + f"/work-acceptances/{acc}/accept", headers=hK, json_body={"quality_score": 10})
    await j.call("contractor2", "POST", P + f"/work-acceptances/{acc}/accept", headers=hK2, json_body={"quality_score": 10})
    await j.call("viewer", "POST", P + f"/work-acceptances/{acc}/accept", headers=hV, json_body={"quality_score": 10})
    j.step("Приёмка: возврат без комментария; с комментарием")
    await j.call("customer", "POST", P + f"/work-acceptances/{acc}/return", headers=hC, json_body={})
    await j.call("customer", "POST", P + f"/work-acceptances/{acc}/return", headers=hC, json_body={"comment": "Не вывезен мусор", "create_issue": True})
    j.step("Доработка: состояние этапа, что видит исполнитель")
    r = await j.call("contractor", "GET", P + f"/stages/{st}", headers=hK)
    print({k: r.json().get(k) for k in ("status", "needs_rework", "rework_deadline", "contractor_ready", "percent_complete")})
    await j.call("contractor", "GET", "/notifications", headers=hK)
    await j.call("contractor", "GET", P + "/issues", headers=hK)
    j.step("Доработка: повторная сдача без правок (гейт), затем исправление и повторная сдача")
    r = await j.call("contractor", "POST", P + f"/stages/{st}/submit", headers=hK)
    r = await j.call("contractor", "GET", P + f"/stages/{st}/workflow", headers=hK)
    for it in r.json()["checklist"]:
        if not it["done"]:
            await j.call("contractor", "POST", P + f"/stages/{st}/checklist/toggle", headers=hK, json_body={"item_id": it["id"], "done": True})
    await j.call("contractor", "GET", P + f"/stages/{st}/completion-check", headers=hK)
    r = await j.call("contractor", "POST", P + f"/stages/{st}/submit", headers=hK)
    acc2 = r.json().get("acceptance_id"); print("new acceptance?", acc2 != acc, acc2)
    j.step("Приёмка: повторное решение по старому acceptance")
    await j.call("customer", "POST", P + f"/work-acceptances/{acc}/accept", headers=hC, json_body={"quality_score": 9})
    j.step("Приёмка: заказчик принимает (открытые замечания есть)")
    r = await j.call("customer", "POST", P + f"/work-acceptances/{acc2}/accept", headers=hC, json_body={"quality_score": 9, "comment": "ок"})
    C["pay_id"] = r.json().get("payment_id"); print("payment", C["pay_id"], "next", r.json().get("next_stage_id"))
    j.step("Приёмка: повтор accept (идемпотентность)")
    await j.call("customer", "POST", P + f"/work-acceptances/{acc2}/accept", headers=hC, json_body={"quality_score": 9})
    j.step("Приёмка: итог — что видят обе роли (stage, budget, payments, issues)")
    for who, h in (("customer", hC), ("contractor", hK)):
        r = await j.call(who, "GET", P, headers=h)
        print(who, [(s_["name"], s_["status"], s_["customer_accepted_at"] is not None) for s_ in r.json()["stages"][:4]], r.json()["progress_percent"], r.json()["budget_spent"])
        await j.call(who, "GET", P + "/payments", headers=h)
    await j.call("contractor", "GET", P + "/issues", headers=hK)


async def phase10_payment(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"; S = C["S"]
    st = S["Демонтаж"]
    j.step("Оплата: прогресс проекта — колонка vs дашборд после приёмки этапа")
    r = await j.call("customer", "GET", P, headers=hC); print("detail.progress_percent", r.json()["progress_percent"], "budget_spent", r.json()["budget_spent"])
    r = await j.call("customer", "GET", P + "/dashboard", headers=hC); print("dashboard.progress_percent", r.json()["progress_percent"])
    j.step("Оплата: список платежей — платёж создан системой при приёмке")
    r = await j.call("customer", "GET", P + "/payments", headers=hC)
    pay = r.json()[0]["id"]; C["pay"] = pay
    j.step("Оплата: исполнитель дублирует «счёт на этап» вручную (POST /payments stage)")
    await j.call("contractor", "POST", P + "/payments", headers=hK, json_body={"title": "Счёт: Демонтаж", "payment_type": "stage", "stage_id": st, "percent": 100, "client_request_id": "pay-req-000001"})
    j.step("Оплата: заказчик создаёт stage-платёж / исполнитель advance")
    await j.call("customer", "POST", P + "/payments", headers=hC, json_body={"title": "x", "payment_type": "stage", "stage_id": st, "amount": 1})
    await j.call("contractor", "POST", P + "/payments", headers=hK, json_body={"title": "x", "payment_type": "advance", "amount": 1})
    j.step("Оплата: счёт из чата (invoice) исполнителем")
    await j.call("contractor", "POST", P + f"/chats/{C['thread']}/invoice", headers=hK, json_body={"title": "Счёт из чата", "amount": 5000, "payment_type": "stage", "client_request_id": "inv-req-0001"})
    await j.call("customer", "GET", P + "/payments", headers=hC)
    j.step("Оплата: реквизиты исполнителя для заказчика")
    await j.call("customer", "GET", P + "/payment-requisites", headers=hC)
    await j.call("viewer", "GET", P + "/payment-requisites", headers=hV)
    j.step("Оплата: оплата этапа, который ещё не принят («Стены»)")
    r = await j.call("contractor", "POST", P + "/payments", headers=hK, json_body={"title": "Счёт: Стены", "payment_type": "stage", "stage_id": S["Стены"], "percent": 100})
    wall = r.json().get("id")
    if wall:
        await j.call("customer", "POST", P + f"/payments/{wall}/confirm", headers=hC, json_body={"transfer_ack": True})
        await j.call("customer", "POST", P + f"/payments/{wall}/yookassa-checkout", headers=hC)
    j.step("Оплата: исполнитель / гость / чужой подтверждают")
    await j.call("contractor", "POST", P + f"/payments/{pay}/confirm", headers=hK, json_body={"transfer_ack": True})
    await j.call("viewer", "POST", P + f"/payments/{pay}/confirm", headers=hV, json_body={"transfer_ack": True})
    j.step("Оплата: подтверждение заказчиком без перевода/чека")
    await j.call("customer", "POST", P + f"/payments/{pay}/confirm", headers=hC, json_body={})
    j.step("Оплата: фискальный чек в dev (scan QR, manual) с привязкой к платежу")
    await j.call("contractor", "POST", P + "/receipts/scan", headers=hK, json_body={"payment_id": pay, "qr_raw": "t=20260927T1200&s=13592.42&fn=9999078901234567&i=12345&fp=1234567890&n=1", "client_request_id": "rcpt-req-0001"})
    await j.call("customer", "GET", P + "/receipts", headers=hC)
    await bprobe(j, "после чека (pending_receipt), платёж ещё pending")
    j.step("Оплата: подтверждение заказчиком с transfer_ack")
    await j.call("customer", "POST", P + f"/payments/{pay}/confirm", headers=hC, json_body={"transfer_ack": True})
    j.step("Оплата: повтор подтверждения")
    await j.call("customer", "POST", P + f"/payments/{pay}/confirm", headers=hC, json_body={"transfer_ack": True})
    await bprobe(j, "сразу после confirm платежа за этап")
    j.step("Оплата: итог — платёж у обеих ролей, budget_spent, ledger (os/expenses), фискальный статус")
    for who, h in (("customer", hC), ("contractor", hK)):
        r = await j.call(who, "GET", P + "/payments", headers=h)
        print(who, [(p["title"], p["status"], p["receipt_id"] is not None) for p in r.json()])
    r = await j.call("customer", "GET", P, headers=hC); print("budget_spent", r.json()["budget_spent"])
    await j.call("customer", "GET", P + "/os/budget", headers=hC)
    await j.call("customer", "GET", P + "/os/expenses", headers=hC)
    await j.call("customer", "GET", "/notifications", headers=hC)
    await j.call("contractor", "GET", "/notifications", headers=hK)
    r = await j.call("customer", "GET", P + "/os/expenses", headers=hC)
    print("EXPENSES:", [(e["title"], e["amount"], e["status"], e.get("source_type"), e.get("payment_id")) for e in r.json()])
    await j.call("customer", "GET", P + "/budget-summary", headers=hC)
    j.step("Оплата: подделка чека исполнителем — QR с иной суммой (1 ₽) привязан к платежу «Счёт из чата» на 5000; заказчик подтверждает без transfer_ack")
    r = await j.call("customer", "GET", P + "/payments", headers=hC)
    chatpay = [p for p in r.json() if p["title"] == "Счёт из чата"][0]["id"]
    await j.call("contractor", "POST", P + "/receipts/scan", headers=hK, json_body={"payment_id": chatpay, "qr_raw": "t=20260927T1200&s=1.00&fn=9999078901234568&i=12346&fp=1234567891&n=1", "client_request_id": "rcpt-req-0002"})
    await j.call("customer", "POST", P + f"/payments/{chatpay}/confirm", headers=hC, json_body={})
    j.step("Оплата: доказательство перевода — upload-intent, загрузка, submit, review исполнителем/заказчиком")
    r = await j.call("customer", "GET", P + "/payments", headers=hC)
    dup = [p for p in r.json() if p["title"] == "Счёт: Демонтаж"][0]["id"]
    r = await j.call("customer", "POST", P + f"/payments/{dup}/evidence/upload-intent", headers=hC, json_body={"client_request_id": "evid-intent-000001", "original_filename": "pp.png", "content_type": "image/png"})
    ev = r.json().get("id") or r.json().get("evidence_id")
    if ev:
        png = base64.b64decode(PNG.split(",")[1])
        r2 = await j.c.put(f"/api/v1{P}/payments/{dup}/evidence/{ev}/content", headers={**hC, "Content-Type": "image/png"}, content=png)
        print("PUT content", r2.status_code, r2.text[:200])
        await j.call("customer", "POST", P + f"/payments/{dup}/evidence/{ev}/submit", headers=hC, json_body={"client_request_id": "evid-submit-000001"})
        await j.call("contractor", "POST", P + f"/payments/{dup}/evidence/{ev}/review", headers=hK, json_body={"client_request_id": "evid-review-000001", "decision": "approve"})
        await j.call("customer", "POST", P + f"/payments/{dup}/evidence/{ev}/review", headers=hC, json_body={"client_request_id": "evid-review-000002", "decision": "approve"})
        await j.call("customer", "GET", P + f"/payments/{dup}/evidence", headers=hC)
        await j.call("contractor", "GET", P + f"/payments/{dup}/evidence", headers=hK)
    j.step("Оплата: спор заказчика по подтверждённому платежу; разрешение подрядчиком/заказчиком")
    await j.call("customer", "POST", P + f"/payments/{pay}/dispute", headers=hC, json_body={"reason": "Оплатил, а акт не подписан по факту"})
    await j.call("contractor", "POST", P + f"/payments/{pay}/dispute", headers=hK, json_body={"reason": "Подрядчик оспаривает платеж заказчика"})
    await j.call("contractor", "POST", P + f"/payments/{pay}/dispute/resolve", headers=hK, json_body={"note": "Разрешаю спор по платежу"})
    await j.call("customer", "POST", P + f"/payments/{pay}/dispute/resolve", headers=hC, json_body={"note": "Сам себе разрешаю спор по платежу"})
    await bprobe(j, "после dispute+resolve")
    j.step("Оплата: ЮKassa demo checkout и внешний налоговый чек «Мой налог» (dev)")
    await j.call("customer", "POST", P + f"/payments/{dup}/yookassa-checkout", headers=hC)
    await j.call("contractor", "GET", "/fns/health", headers=hK)
    await j.call("contractor", "POST", "/fns/moy-nalog/oauth/start", headers=hK)
    await j.call("customer", "GET", P + "/payments", headers=hC)
    await j.call("customer", "GET", P + "/receipts", headers=hC)


async def phase11_change_order(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"
    r = await j.call("customer", "GET", P, headers=hC); b0 = r.json()["budget_planned"]; print("budget_planned before CO", b0)
    j.step("Допработы: заказчик/гость/чужой создают CO")
    await j.call("customer", "POST", P + "/change-orders", headers=hC, json_body={"title": "Тёплый пол", "amount": 30000})
    await j.call("viewer", "POST", P + "/change-orders", headers=hV, json_body={"title": "Тёплый пол", "amount": 30000})
    await j.call("contractor2", "POST", P + "/change-orders", headers=hK2, json_body={"title": "Тёплый пол", "amount": 30000})
    await bprobe(j, "перед CO")
    j.step("Допработы: исполнитель создаёт CO (+ повтор с тем же request_id, + amount<=0)")
    r = await j.call("contractor", "POST", P + "/change-orders", headers=hK, json_body={"title": "Тёплый пол", "amount": 30000, "description": "электрический", "client_request_id": "co-req-00001"})
    co = r.json()["id"]
    await j.call("contractor", "POST", P + "/change-orders", headers=hK, json_body={"title": "Тёплый пол", "amount": 30000, "description": "электрический", "client_request_id": "co-req-00001"})
    await j.call("contractor", "POST", P + "/change-orders", headers=hK, json_body={"title": "Нулевой", "amount": 0})
    j.step("Допработы: заказчик видит список, уведомление; бюджет ДО согласования")
    await j.call("customer", "GET", P + "/change-orders", headers=hC)
    r = await j.call("customer", "GET", "/notifications", headers=hC)
    print([n["title"] for n in r.json()][:6])
    j.step("Допработы: исполнитель/гость/чужой согласуют")
    await j.call("contractor", "POST", P + f"/change-orders/{co}/approve", headers=hK)
    await j.call("viewer", "POST", P + f"/change-orders/{co}/approve", headers=hV)
    j.step("Допработы: заказчик согласует; повтор")
    r = await j.call("customer", "POST", P + f"/change-orders/{co}/approve", headers=hC)
    print("approve resp", r.json())
    await j.call("customer", "POST", P + f"/change-orders/{co}/approve", headers=hC)
    await bprobe(j, "после approve CO")
    j.step("Допработы: после согласования — бюджет, документ, платежи, график, смета")
    r = await j.call("customer", "GET", P, headers=hC); print("budget_planned after CO", r.json()["budget_planned"], "lines", len(r.json()["estimate_lines"]), "locked", r.json()["estimate_locked_at"])
    r = await j.call("customer", "GET", P + "/documents", headers=hC)
    cods = [d for d in r.json()["items"] if "Доп" in (d.get("title") or "")]
    print("CO docs:", [(d["id"], d["status"], d["kind"], d.get("href")) for d in cods])
    await j.call("customer", "GET", P + "/payments", headers=hC)
    await j.call("contractor", "GET", "/notifications", headers=hK)
    if cods:
        j.step("Допработы: подпись CO-документа заказчиком и исполнителем")
        await j.call("customer", "POST", P + f"/documents/{cods[0]['id']}/sign", headers=hC, json_body={"provider": "in_app"})
        await j.call("contractor", "POST", P + f"/documents/{cods[0]['id']}/sign", headers=hK, json_body={"provider": "in_app"})
    j.step("Допработы: оплата CO — есть ли способ создать платёж под CO (тип, привязка)")
    await j.call("contractor", "POST", P + "/payments", headers=hK, json_body={"title": "Оплата доп. работ: Тёплый пол", "payment_type": "material", "amount": 30000})
    j.step("Допработы: отклонение CO (второй) и попытка согласовать/повторно создать")
    r = await j.call("contractor", "POST", P + "/change-orders", headers=hK, json_body={"title": "Лишнее", "amount": 5000})
    co2 = r.json()["id"]
    await j.call("customer", "POST", P + f"/change-orders/{co2}/reject", headers=hC)
    await j.call("customer", "POST", P + f"/change-orders/{co2}/reject", headers=hC)
    await j.call("customer", "POST", P + f"/change-orders/{co2}/approve", headers=hC)
    await j.call("contractor", "GET", P + "/change-orders", headers=hK)
    await j.call("contractor", "GET", "/notifications", headers=hK)

async def phase12_materials(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"
    j.step("Закупка: потребность из сметы (from-estimate)")
    await j.call("customer", "POST", P + "/material-needs/from-estimate", headers=hC, json_body={})
    r = await j.call("contractor", "POST", P + "/material-needs/from-estimate", headers=hK, json_body={"client_request_id": "needs-req-0001"})
    await j.call("contractor", "POST", P + "/material-needs/from-estimate", headers=hK, json_body={"client_request_id": "needs-req-0002"})
    r = await j.call("customer", "GET", P + "/material-picks", headers=hC)
    picks = r.json(); print("picks", [(p["name"], p["status"], p["qty"], p["price"]) for p in picks][:12], len(picks))
    C["picks"] = picks
    j.step("Закупка: гость/чужой смотрят и создают выбор")
    await j.call("viewer", "GET", P + "/material-picks", headers=hV)
    await j.call("viewer", "POST", P + "/material-picks", headers=hV, json_body={"name": "гость", "qty": 1})
    await j.call("contractor2", "GET", P + "/material-picks", headers=hK2)
    j.step("Закупка: исполнитель подбирает материал вручную, цена, отправляет на согласование")
    r = await j.call("contractor", "POST", P + "/material-picks", headers=hK, json_body={"name": "Ротбанд 30кг", "qty": 10, "unit": "меш", "price": 800, "shop_name": "Леруа", "client_request_id": "pick-req-00001"})
    pk = r.json()["id"]
    await j.call("contractor", "POST", P + f"/material-picks/{pk}/submit", headers=hK)
    j.step("Закупка: закупка ДО согласования выбора")
    await j.call("contractor", "POST", P + "/purchases", headers=hK, json_body={"material_pick_ids": [pk], "supplier_name": "Леруа", "client_request_id": "purch-req-0001"})
    j.step("Закупка: исполнитель/гость согласуют; заказчик согласует")
    await j.call("contractor", "POST", P + f"/material-picks/{pk}/approve", headers=hK)
    await j.call("customer", "POST", P + f"/material-picks/{pk}/approve", headers=hC)
    j.step("Закупка: создание закупки; повтор; статусы ordered→paid→delivered; пропуск статуса")
    r = await j.call("contractor", "POST", P + "/purchases", headers=hK, json_body={"material_pick_ids": [pk], "supplier_name": "Леруа", "client_request_id": "purch-req-0002"})
    pu = r.json().get("id")
    if pu:
        await j.call("contractor", "POST", P + "/purchases", headers=hK, json_body={"material_pick_ids": [pk], "supplier_name": "Леруа", "client_request_id": "purch-req-0002"})
        await j.call("contractor", "POST", P + "/purchases", headers=hK, json_body={"material_pick_ids": [pk], "supplier_name": "Леруа", "client_request_id": "purch-req-0003"})
        for stt in ("delivered", "approved", "ordered", "paid", "delivered", "delivered"):
            await j.call("contractor", "POST", P + f"/purchases/{pu}/status", headers=hK, json_body={"status": stt})
        await j.call("viewer", "POST", P + f"/purchases/{pu}/status", headers=hV, json_body={"status": "cancelled"})
    await bprobe(j, "после delivered закупки")
    j.step("Закупка: что видят стороны после поставки (picks, материалы-статистика, бюджет, уведомления)")
    r = await j.call("customer", "GET", P + "/material-picks", headers=hC)
    print("pick after:", [(p["name"], p["status"], p["qty_delivered"]) for p in r.json() if p["id"] == pk])
    await j.call("customer", "GET", P + "/purchases", headers=hC)
    await j.call("customer", "GET", P + "/estimate/materials-stats", headers=hC)
    await j.call("customer", "GET", "/notifications", headers=hC)
    await j.call("customer", "GET", P + "/os/budget", headers=hC)


async def phase13_close(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"
    j.step("Завершение: готовность проекта ДО закрытия этапов (closeout-checklist), попытка closeout")
    await j.call("customer", "GET", P + "/closeout-checklist", headers=hC)
    await j.call("customer", "POST", P + "/closeout", headers=hC)
    r = await j.call("customer", "GET", P, headers=hC)
    stages = sorted(r.json()["stages"], key=lambda s_: s_["sort_order"])
    j.step("Завершение: проходим оставшиеся этапы (старт → чек-лист → фото → submit → приёмка)")
    for stg in stages:
        if stg["status"] == "done":
            continue
        sid = stg["id"]; name = stg["name"]
        cur = (await j.call("customer", "GET", P + f"/stages/{sid}", headers=hC)).json()["status"]
        if cur == "planned":
            await j.call("contractor", "POST", P + f"/stages/{sid}/start", headers=hK, note=f"start {name}")
        wf = (await j.call("contractor", "GET", P + f"/stages/{sid}/workflow", headers=hK)).json()
        for it in wf.get("checklist", []):
            if not it["done"]:
                await j.call("contractor", "POST", P + f"/stages/{sid}/checklist/toggle", headers=hK, json_body={"item_id": it["id"], "done": True})
        await j.call("contractor", "POST", P + f"/stages/{sid}/photos", headers=hK, json_body={"image_data": PNG, "caption": f"{name}"}, note="1 photo caption without keyword")
        await j.call("contractor", "GET", P + f"/stages/{sid}/completion-check", headers=hK)
        await j.call("contractor", "POST", P + f"/stages/{sid}/photos", headers=hK, json_body={"image_data": PNG, "caption": f"Результат: {name}"})
        r = await j.call("contractor", "POST", P + f"/stages/{sid}/submit", headers=hK, note=f"submit {name}")
        acc = r.json().get("acceptance_id")
        if acc:
            await j.call("customer", "POST", P + f"/work-acceptances/{acc}/accept", headers=hC, json_body={"quality_score": 8}, note=f"accept {name}")
    r = await j.call("customer", "GET", P, headers=hC)
    print([(s_["name"], s_["status"]) for s_ in sorted(r.json()["stages"], key=lambda s_: s_["sort_order"])])
    j.step("Завершение: closeout сразу — оплаты ещё pending, акты?")
    await j.call("customer", "GET", P + "/closeout-checklist", headers=hC)
    r = await j.call("customer", "POST", P + "/closeout", headers=hC)
    r = await j.call("customer", "GET", P + "/payments", headers=hC)
    pend = [p for p in r.json() if p["status"] == "pending"]
    print("pending payments:", [(p["title"], p["amount"], p["stage_id"] is not None) for p in pend])
    j.step("Завершение: отмена/удаление ошибочных счетов — есть ли способ (cancel/delete)")
    if pend:
        await j.call("contractor", "DELETE", P + f"/payments/{pend[0]['id']}", headers=hK)
        await j.call("contractor", "PATCH", P + f"/payments/{pend[0]['id']}", headers=hK, json_body={"status": "cancelled"})
        await j.call("contractor", "POST", P + f"/payments/{pend[0]['id']}/cancel", headers=hK)
        await j.call("customer", "POST", P + f"/payments/{pend[0]['id']}/cancel", headers=hC)
    j.step("Завершение: единственный способ закрыть ошибочный счёт — «подтвердить» его (transfer_ack)")
    for p in pend:
        await j.call("customer", "POST", P + f"/payments/{p['id']}/confirm", headers=hC, json_body={"transfer_ack": True}, note=p["title"])
    await j.call("customer", "GET", P + "/closeout-checklist", headers=hC)
    await bprobe(j, "после подтверждения всех счетов (paid_unverified путь)")
    j.step("Завершение: акты приёмки в документах; closeout")
    r = await j.call("customer", "GET", P + "/documents", headers=hC)
    print("docs:", [(d["title"], d["kind"], d["status"]) for d in r.json()["items"]])
    await j.call("contractor", "POST", P + "/closeout", headers=hK)
    r = await j.call("customer", "POST", P + "/closeout", headers=hC)
    C["closeout"] = r.status_code

async def phase13b_warranty(j):
    pid = C["pid"]; hC, hK, hK2, hV = C["hC"], C["hK"], C["hK2"], C["hV"]; P = f"/projects/{pid}"
    j.step("Гарантия: после closeout — что видят обе роли, права записи")
    for who, h in (("customer", hC), ("contractor", hK), ("viewer", hV)):
        r = await j.call(who, "GET", P, headers=h); print(who, {k: r.json().get(k) for k in ("is_archived", "read_only", "access_mode")})
    j.step("После closeout: исполнитель пишет в закрытый проект (платёж, CO, issue, комментарий)")
    await j.call("contractor", "POST", P + "/payments", headers=hK, json_body={"title": "Постфактум счёт", "payment_type": "material", "amount": 100})
    await j.call("contractor", "POST", P + "/change-orders", headers=hK, json_body={"title": "Постфактум CO", "amount": 100})
    await j.call("customer", "GET", P + "/closeout-checklist", headers=hC)
    j.step("Гарантия: обращение заказчика; повтор; исполнителя; гостя")
    r = await j.call("customer", "POST", P + "/warranty-claims", headers=hC, json_body={"title": "Трещина в ламинате", "description": "через 2 недели после сдачи", "client_request_id": "warr-req-00001"})
    await j.call("customer", "POST", P + "/warranty-claims", headers=hC, json_body={"title": "Трещина в ламинате", "description": "через 2 недели после сдачи", "client_request_id": "warr-req-00001"})
    await j.call("viewer", "POST", P + "/warranty-claims", headers=hV, json_body={"title": "гость", "client_request_id": "warr-req-00002"})
    await j.call("contractor2", "POST", P + "/warranty-claims", headers=hK2, json_body={"title": "чужой", "client_request_id": "warr-req-00003"})
    r = await j.call("contractor", "GET", P + "/warranty-claims", headers=hK)
    claims = r.json(); print("claims", claims if isinstance(claims, list) else claims)
    await j.call("contractor", "GET", "/notifications", headers=hK)
    items = claims if isinstance(claims, list) else claims.get("items", [])
    if items:
        cid = items[0]["id"]
        j.step("Гарантия: закрытие — исполнителем (403?) и заказчиком; SLA/срок гарантии")
        await j.call("contractor", "POST", P + f"/warranty-claims/{cid}/close", headers=hK)
        await j.call("customer", "POST", P + f"/warranty-claims/{cid}/close", headers=hC)
    j.step("Гарантия: исполнитель работает по замечанию гарантийного обращения — issue transition")
    r = await j.call("contractor", "GET", P + "/issues", headers=hK)

async def phase14_trash(j):
    pid = C["pid"]; hC, hK, hV = C["hC"], C["hK"], C["hV"]; P = f"/projects/{pid}"
    j.step("Корзина: чужие/исполнитель/гость")
    await j.call("contractor", "POST", P + "/trash", headers=hK)
    await j.call("viewer", "POST", P + "/trash", headers=hV)
    await j.call("contractor2", "POST", P + "/trash", headers=C["hK2"])
    j.step("Корзина: purge не из корзины")
    await j.call("customer", "DELETE", P, headers=hC)
    j.step("Корзина: заказчик в корзину ЗАВЕРШЁННЫЙ (archived) проект; что видит исполнитель и гость")
    r = await j.call("customer", "GET", P, headers=hC); print("before trash", r.json()["is_archived"])
    await j.call("customer", "POST", P + "/trash", headers=hC)
    await j.call("contractor", "GET", P, headers=hK)
    await j.call("contractor", "GET", "/projects", headers=hK)
    await j.call("contractor", "POST", P + "/chats", headers=hK, json_body={"title": "x"})
    await j.call("viewer", "GET", P, headers=hV)
    await j.call("contractor", "GET", "/notifications", headers=hK)
    await j.call("customer", "GET", "/projects?bucket=trashed", headers=hC)
    j.step("Корзина: восстановление; состояние archived; контракт/платежи целы?")
    r = await j.call("customer", "POST", P + "/restore", headers=hC); print("after restore is_archived", r.json()["is_archived"], "trashed", r.json()["trashed_at"])
    await j.call("customer", "GET", "/projects", headers=hC)
    await j.call("contractor", "GET", P + "/payments", headers=hK)
    await j.call("customer", "GET", P + "/closeout-checklist", headers=hC)
    r = await j.call("contractor", "GET", "/notifications", headers=hK); print("contractor notif titles after trash:", [n["title"] for n in r.json()][:8])
    j.step("Корзина: purge завершённого проекта с подписанным договором и оплатами (неотменяемо)")
    await j.call("customer", "POST", P + "/trash", headers=hC)
    await j.call("contractor", "DELETE", P, headers=hK)
    await j.call("customer", "DELETE", P, headers=hC)
    await j.call("customer", "GET", P, headers=hC)
    await j.call("contractor", "GET", P, headers=hK)
    await j.call("contractor", "GET", "/projects", headers=hK)
    await j.call("contractor", "GET", "/notifications", headers=hK)
    j.step("Корзина: empty trash")
    await j.call("customer", "DELETE", "/projects/trash/empty", headers=hC)


async def phase3e_marketplace(j):
    hC, h5 = C["hC"], C["hK5"]
    j.step("Маркетплейс: заказчик публикует заявку; исполнитель без профиля видит и делает оценку")
    r = await j.call("customer", "POST", "/job-leads", headers=hC, json_body={"title": "Ремонт 2к", "address": "Москва, Тверская 5", "area_sqm": 60, "renovation_type": "cosmetic", "budget_hint": 500000, "description": "под ключ"})
    lead = r.json()["id"]
    r = await j.call("contractor5", "GET", "/job-leads", headers=h5)
    print("lead as seen by contractor:", r.json()[0] if r.json() else None)
    r = await j.call("contractor5", "POST", f"/job-leads/{lead}/quote", headers=h5, json_body={"pre_estimate": 480000})
    qid = r.json().get("id") or r.json().get("quote_id")
    j.step("Маркетплейс: заказчик принимает оценку, конвертирует в проект")
    r = await j.call("customer", "GET", "/job-leads", headers=hC); print("lead as seen by customer:", r.json()[0])
    qid = r.json()[0]["quotes"][0]["id"]
    await j.call("customer", "POST", f"/job-leads/{lead}/quotes/{qid}/accept", headers=hC)
    await j.call("contractor5", "POST", f"/job-leads/{lead}/quote", headers=h5, json_body={"pre_estimate": 1})
    r = await j.call("customer", "POST", f"/job-leads/{lead}/convert", headers=hC, json_body={"property_type": "apartment"})
    print("converted:", {k: r.json().get(k) for k in ("id", "project_id", "contractor_id")} if isinstance(r.json(), dict) else r.json())
    pid2 = r.json().get("project_id") or r.json().get("id")
    if pid2:
        await j.call("contractor5", "GET", f"/projects/{pid2}", headers=h5)
        await j.call("contractor5", "GET", "/projects", headers=h5)
        await j.call("contractor5", "GET", "/notifications", headers=h5)

async def phase3f_team(j):
    hK, hK4 = C["hK"], C["hK7"]; P = f"/projects/{C['pid']}"
    j.step("Команда: исполнитель создаёт команду, ссылка-приглашение прораба, прораб присоединяется")
    await j.call("contractor", "POST", "/teams", headers=hK, json_body={"name": "Бригада Подрядова"})
    r = await j.call("contractor", "POST", "/teams/invite-link", headers=hK, json_body={"role": "foreman"})
    tok = r.json().get("token") or (r.json().get("url") or "").split("token=")[-1]
    print("invite token", tok)
    await j.call("contractor7", "POST", "/teams/join", headers=hK4, json_body={"token": tok})
    await j.call("contractor7", "GET", "/teams/me", headers=hK4)
    j.step("Команда: что может прораб на проекте руководителя (чтение, график, смета)")
    await j.call("contractor7", "GET", P, headers=hK4)
    await j.call("contractor7", "GET", "/projects", headers=hK4)
    await j.call("contractor7", "POST", P + "/work-schedules", headers=hK4, json_body={"title": "прораб", "items": []})
    j.step("Команда: видит ли заказчик прораба/команду подрядчика")
    await j.call("customer", "GET", P + "/participants", headers=C["hC"])
    await j.call("customer", "GET", P, headers=C["hC"])
    await j.call("contractor7", "POST", P + "/estimate/lines", headers=hK4, json_body={"line_type": "work", "name": "прораб", "unit": "m2", "quantity_planned": 1, "unit_price": 1})


async def phase8b_chat_invite(j):
    hC = C["hC"]; P = f"/projects/{C['pid']}"
    j.step("Чат-приглашение: заказчик приглашает неподключённого исполнителя в тред по телефону")
    await j.call("customer", "POST", P + f"/chats/{C['thread']}/invite", headers=hC, json_body={"phone": C["cont2"]["phone"]})
    await j.call("contractor2", "GET", P + f"/chats/{C['thread']}", headers=C["hK2"])
    await j.call("contractor2", "POST", P + f"/chats/{C['thread']}/messages", headers=C["hK2"], json_body={"client_request_id": "msg-req-00009", "text": "Я приглашённый, привет"})
    await j.call("contractor2", "GET", P, headers=C["hK2"])
    await j.call("contractor2", "GET", P + "/estimate.csv", headers=C["hK2"])
    await j.call("contractor2", "GET", P + "/documents", headers=C["hK2"])
    await j.call("contractor2", "GET", "/chats/inbox", headers=C["hK2"])


ORDER = [
    "phase1", "phase2", "phase3", "phase3c_connect", "phase3b_hijack", "phase3d_selfmanaged",
    "phase3e_marketplace", "phase3f_team", "phase4_estimate", "phase5_contract", "phase5b_customer_sign",
    "phase5c_customer_only_gate", "phase5d_gate_before_lock", "phase6_schedule", "phase7_start",
    "phase8_execute", "phase8b_chat_invite", "phase9_acceptance", "phase10_payment", "phase11_change_order",
    "phase12_materials", "phase13_close", "phase13b_warranty", "phase14_trash",
]


async def run_all():
    await setup_isolated_db()
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        j = J(c)
        for name in ORDER:
            await globals()[name](j)
    path = os.environ.get("JOURNEY_LOG", "/tmp/journey13-log.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(LOG, fh, ensure_ascii=False, indent=1, default=str)
    return LOG


async def test_journey():  # pytest-asyncio (asyncio_mode=auto в backend/pyproject.toml)
    log = await run_all()
    assert len(log) > 300


if __name__ == "__main__":
    asyncio.run(run_all())
