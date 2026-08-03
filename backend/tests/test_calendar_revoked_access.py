from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.timeutil import utc_now
from app.models.entities import CalendarItem, Project, User, UserRole
from app.services import calendar_integrity_service as calendar_svc


@pytest.mark.asyncio
async def test_owned_project_item_is_hidden_after_access_revocation(db):
    customer = User(
        id="calendar-revoked-customer",
        phone="+78700000001",
        role=UserRole.customer,
    )
    former_contractor = User(
        id="calendar-revoked-contractor",
        phone="+78700000002",
        role=UserRole.contractor,
    )
    replacement = User(
        id="calendar-replacement-contractor",
        phone="+78700000003",
        role=UserRole.contractor,
    )
    project = Project(
        id="calendar-revoked-project",
        name="Revoked project",
        renovation_type="cosmetic",
        customer_id=customer.id,
        contractor_id=replacement.id,
    )
    start_at = utc_now() + timedelta(days=1)
    db.add_all(
        [
            customer,
            former_contractor,
            replacement,
            project,
            CalendarItem(
                id="calendar-revoked-project-item",
                user_id=former_contractor.id,
                project_id=project.id,
                title="REVOKED_PROJECT_EVENT",
                start_at=start_at,
                end_at=start_at + timedelta(hours=1),
                is_public=False,
            ),
            CalendarItem(
                id="calendar-revoked-personal-item",
                user_id=former_contractor.id,
                project_id=None,
                title="PERSONAL_EVENT",
                start_at=start_at,
                end_at=start_at + timedelta(hours=1),
                is_public=False,
            ),
        ]
    )
    await db.commit()
    actor = await db.get(User, former_contractor.id)
    assert actor is not None

    titles = {
        item.title for item in await calendar_svc.visible_items(db, user=actor)
    }

    assert titles == {"PERSONAL_EVENT"}
