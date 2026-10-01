"""STG-003/004/007/008/009/012 + JRN-015: work-schedule revisions, derived item
status, date validation and the calendar paths honouring the same locks."""
from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.main import app
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import Project, Stage, StageStatus, User, UserRole
from app.models.work_schedule import ProjectWorkSchedule, ProjectWorkScheduleItem, WorkScheduleStatus

PID = "p-rev"
BASE = f"/api/v1/projects/{PID}/work-schedules"


async def _seed(db):
    ct = User(id="ct-rev", phone="+79990007001", role=UserRole.contractor)
    cu = User(id="cu-rev", phone="+79990007002", role=UserRole.customer)
    project = Project(
        id=PID, name="R", renovation_type="cosmetic", customer_id=cu.id, contractor_id=ct.id,
        budget_planned=1, budget_spent=0,
    )
    s1 = Stage(id="st-rev-1", project_id=PID, name="Демонтаж", sort_order=0)
    s2 = Stage(id="st-rev-2", project_id=PID, name="Электрика", sort_order=1)
    db.add_all([ct, cu, project, s1, s2])
    await db.commit()
    return User(id=ct.id, phone=ct.phone, role=ct.role), User(id=cu.id, phone=cu.phone, role=cu.role)


class _As:
    def __init__(self, db):
        self.db = db
        self.client = None

    async def __call__(self, actor):
        if self.client:
            await self.client.aclose()

        async def _db():
            yield self.db

        detached = User(id=actor.id, phone=actor.phone, role=actor.role)  # survives session expiry

        async def _user():
            return detached

        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = _user
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        return self.client

    async def close(self):
        if self.client:
            await self.client.aclose()
        app.dependency_overrides.clear()


def _items(start="2026-10-05", finish="2026-10-12"):
    return [
        {"stage_id": "st-rev-1", "title": "Демонтаж", "planned_start_date": start,
         "planned_finish_date": finish, "sort_order": 0},
        {"stage_id": "st-rev-2", "title": "Электрика", "planned_start_date": "2026-10-13",
         "planned_finish_date": "2026-10-20", "sort_order": 1},
    ]


async def _confirmed(db, as_):
    ct, cu = await _seed(db)
    c = await as_(ct)
    r = await c.post(BASE, json={"title": "План", "items": _items()})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert (await c.post(f"{BASE}/{sid}/submit")).status_code == 200
    c = await as_(cu)
    r = await c.post(f"{BASE}/{sid}/confirm")
    assert r.status_code == 200, r.text
    return ct, cu, sid


@pytest.mark.asyncio
async def test_finish_before_start_is_422(db):
    as_ = _As(db)
    ct, cu = await _seed(db)
    try:
        c = await as_(ct)
        bad = _items(start="2026-10-10", finish="2026-10-05")
        assert (await c.post(BASE, json={"title": "x", "items": bad})).status_code == 422
        assert (
            await c.post(BASE, json={"title": "x", "items": [], "planned_start_date": "2026-10-10",
                                     "planned_finish_date": "2026-10-01"})
        ).status_code == 422
        r = await c.post(BASE, json={"title": "ok", "items": _items()})
        sid = r.json()["id"]
        assert (await c.put(f"{BASE}/{sid}", json={"items": bad})).status_code == 422
        # partial update is checked against the stored range
        assert (await c.put(f"{BASE}/{sid}", json={"planned_start_date": "2026-10-01",
                                                   "planned_finish_date": "2026-11-01"})).status_code == 200
        assert (await c.put(f"{BASE}/{sid}", json={"planned_finish_date": "2026-09-01"})).status_code == 422
    finally:
        await as_.close()


@pytest.mark.asyncio
async def test_confirmed_schedule_revision_cycle(db):
    as_ = _As(db)
    try:
        ct, cu, sid = await _confirmed(db, as_)
        c = await as_(ct)
        r = await c.put(f"{BASE}/{sid}", json={"title": "x"})
        assert r.status_code == 409 and "revisions" in r.text
        # a second independent schedule must not shadow the confirmed one
        r = await c.post(BASE, json={"title": "Plan 2", "items": _items()})
        assert r.status_code == 409 and "confirmed_schedule_exists_use_revision" in r.text
        # only the executor requests a revision
        assert (await (await as_(cu)).post(f"{BASE}/{sid}/revisions")).status_code == 403
        c = await as_(ct)
        r = await c.post(f"{BASE}/{sid}/revisions")
        assert r.status_code == 200, r.text
        rev = r.json()
        assert rev["status"] == "draft" and rev["supersedes_id"] == sid and rev["schedule_version"] == 2
        assert len(rev["items"]) == 2
        assert (await c.post(f"{BASE}/{sid}/revisions")).status_code == 409
        # draft revision does not replace the confirmed one in /active
        active = (await c.get(f"{BASE}/active")).json()
        assert active["id"] == sid and active["status"] == "confirmed"
        # until confirmed, the confirmed schedule still locks stage dates
        r = await c.patch("/api/v1/projects/%s/calendar/stages" % PID,
                          json={"stage_id": "st-rev-1", "planned_start": "2026-10-06"})
        assert r.status_code == 409
        # edit + submit + customer rejects -> original still in force
        new_items = _items(start="2026-10-07", finish="2026-10-14")
        assert (await c.put(f"{BASE}/{rev['id']}", json={"items": new_items})).status_code == 200
        assert (await c.post(f"{BASE}/{rev['id']}/submit")).status_code == 200
        c = await as_(cu)
        assert (await c.post(f"{BASE}/{rev['id']}/reject", json={"reason": "нет"})).status_code == 200
        assert (await c.get(f"{BASE}/active")).json()["id"] == sid
        c = await as_(ct)
        assert (await c.post(f"{BASE}/{rev['id']}/submit")).status_code == 200
        c = await as_(cu)
        r = await c.post(f"{BASE}/{rev['id']}/confirm")
        assert r.status_code == 200 and r.json()["status"] == "confirmed"
        active = (await c.get(f"{BASE}/active")).json()
        assert active["id"] == rev["id"]
        old = await db.get(ProjectWorkSchedule, sid)
        await db.refresh(old)
        assert old.status == WorkScheduleStatus.archived
        stage = await db.get(Stage, "st-rev-1")
        await db.refresh(stage)
        assert stage.planned_start == date(2026, 10, 7) and stage.planned_end == date(2026, 10, 14)
    finally:
        await as_.close()


@pytest.mark.asyncio
async def test_revision_confirm_does_not_touch_done_stage_dates(db):
    as_ = _As(db)
    try:
        ct, cu, sid = await _confirmed(db, as_)
        stage = await db.get(Stage, "st-rev-1")
        stage.status = StageStatus.done
        await db.commit()
        c = await as_(ct)
        rev = (await c.post(f"{BASE}/{sid}/revisions")).json()
        await c.put(f"{BASE}/{rev['id']}", json={"items": _items(start="2026-11-01", finish="2026-11-02")})
        await c.post(f"{BASE}/{rev['id']}/submit")
        c = await as_(cu)
        assert (await c.post(f"{BASE}/{rev['id']}/confirm")).status_code == 200
        await db.refresh(stage)
        assert stage.planned_start == date(2026, 10, 5)
    finally:
        await as_.close()


@pytest.mark.asyncio
async def test_item_status_cannot_move_stage_and_mirrors_it(db):
    as_ = _As(db)
    ct, cu = await _seed(db)
    try:
        c = await as_(ct)
        sch = (await c.post(BASE, json={"title": "p", "items": _items()})).json()
        item = next(i for i in sch["items"] if i["stage_id"] == "st-rev-1")
        for target in ("in_progress", "submitted", "accepted"):
            r = await c.post(f"{BASE}/{sch['id']}/items/{item['id']}/status", json={"status": target})
            assert r.status_code == 409, (target, r.text)
        stage = await db.get(Stage, "st-rev-1")
        await db.refresh(stage)
        assert stage.status == StageStatus.planned
        # the canonical stage state is reflected on read, without rewriting the row
        stage.status = StageStatus.review
        await db.commit()
        got = (await c.get(f"{BASE}/{sch['id']}")).json()
        assert next(i for i in got["items"] if i["id"] == item["id"])["status"] == "submitted"
        row = await db.get(ProjectWorkScheduleItem, item["id"])
        await db.refresh(row)
        assert row.status.value == "planned"
    finally:
        await as_.close()


@pytest.mark.asyncio
async def test_calendar_stage_dates_patch_follows_schedule_rules(db):
    as_ = _As(db)
    ct, cu = await _seed(db)
    url = f"/api/v1/projects/{PID}/calendar/stages"
    try:
        r = await (await as_(cu)).patch(url, json={"stage_id": "st-rev-1", "planned_start": "2026-10-06"})
        assert r.status_code == 403
        c = await as_(ct)
        r = await c.patch(url, json={"stage_id": "st-rev-1", "planned_start": "2026-10-06",
                                     "planned_end": "2026-10-08"})
        assert r.status_code == 200, r.text
        r = await c.patch(url, json={"stage_id": "st-rev-1", "planned_start": "2026-10-09",
                                     "planned_end": "2026-10-08"})
        assert r.status_code == 422
        stage = await db.get(Stage, "st-rev-1")
        stage.status = StageStatus.done
        await db.commit()
        r = await c.patch(url, json={"stage_id": "st-rev-1", "planned_start": "2026-10-01"})
        assert r.status_code == 409 and "stage_dates_locked_done" in r.text
    finally:
        await as_.close()


def _ics(title, start, end_excl, uid=None):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT"]
    if uid:
        lines.append(f"UID:{uid}")
    lines += [f"SUMMARY:{title}", f"DTSTART;VALUE=DATE:{start}", f"DTEND;VALUE=DATE:{end_excl}",
              "END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(lines)


@pytest.mark.asyncio
async def test_ical_import_roles_lock_and_done_stage(db):
    as_ = _As(db)
    ct, cu = await _seed(db)
    url = f"/api/v1/projects/{PID}/calendar/import"
    try:
        content = _ics("Демонтаж", "20270101", "20270103")
        r = await (await as_(cu)).post(url, json={"content": content})
        assert r.status_code == 403
        stage = await db.get(Stage, "st-rev-2")
        stage.status = StageStatus.done
        await db.commit()
        c = await as_(ct)
        r = await c.post(url, json={"content": _ics("Электрика и слаботочка", "20270201", "20270203")})
        assert r.status_code == 200 and r.json()["updated_stages"] == 0
        await db.refresh(stage)
        assert stage.planned_start is None  # done stage untouched
        r = await c.post(url, json={"content": content})
        assert r.status_code == 200 and r.json()["updated_stages"] == 1
        # confirmed schedule locks the import
        sch = (await c.post(BASE, json={"title": "p", "items": _items()})).json()
        await c.post(f"{BASE}/{sch['id']}/submit")
        await (await as_(cu)).post(f"{BASE}/{sch['id']}/confirm")
        r = await (await as_(ct)).post(url, json={"content": _ics("Демонтаж", "20270301", "20270303")})
        assert r.status_code == 409
    finally:
        await as_.close()
