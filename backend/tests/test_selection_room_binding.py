from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1 import selections as api
from app.models.entities import Project, Room, SelectionItem, User, UserRole


@pytest.mark.asyncio
async def test_selection_create_binds_optional_room_to_path_project(db):
    customer = User(id="selection-room-user", phone="+79990004780", role=UserRole.customer)
    db.add(customer)
    await db.flush()

    project_a = Project(
        id="selection-room-project-a",
        name="Selection A",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    project_b = Project(
        id="selection-room-project-b",
        name="Selection B",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add_all([project_a, project_b])
    await db.flush()

    room_a = Room(
        id="selection-room-a",
        project_id=project_a.id,
        name="Room A",
        room_type="living",
        length_m=4,
        width_m=3,
    )
    room_b = Room(
        id="selection-room-b",
        project_id=project_b.id,
        name="Room B",
        room_type="living",
        length_m=5,
        width_m=3,
    )
    db.add_all([room_a, room_b])
    await db.commit()

    with pytest.raises(HTTPException) as foreign_room:
        await api.create_selection(
            project_a.id,
            api.SelectionIn(title="Foreign selection", room_id=room_b.id),
            user=customer,
            db=db,
        )
    assert foreign_room.value.status_code == 404

    leaked = (
        await db.execute(
            select(SelectionItem).where(
                SelectionItem.project_id == project_a.id,
                SelectionItem.title == "Foreign selection",
            )
        )
    ).scalar_one_or_none()
    assert leaked is None

    own = await api.create_selection(
        project_a.id,
        api.SelectionIn(title="Own selection", room_id=room_a.id),
        user=customer,
        db=db,
    )
    assert own["project_id"] == project_a.id
    assert own["room_id"] == room_a.id

    no_room = await api.create_selection(
        project_a.id,
        api.SelectionIn(title="Project-wide selection", room_id=None),
        user=customer,
        db=db,
    )
    assert no_room["project_id"] == project_a.id
    assert no_room["room_id"] is None
