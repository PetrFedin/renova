from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register canonical ORM metadata
from app.api.v1 import chats as chats_api
from app.db.base import Base
from app.models.entities import ChatThread, ChatThreadParticipant, Project, User, UserRole
from app.services.chat_acl import require_chat_access


async def _session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


@pytest.mark.asyncio
async def test_exact_thread_participant_can_use_only_invited_thread_without_project_authority():
    engine, Session = await _session_factory()
    try:
        async with Session() as db:
            customer = User(
                id="acl-customer",
                phone="+79990000201",
                role=UserRole.customer,
                full_name="ACL customer",
            )
            contractor = User(
                id="acl-contractor",
                phone="+79990000202",
                role=UserRole.contractor,
                full_name="ACL contractor",
            )
            invited = User(
                id="acl-invited",
                phone="+79990000203",
                role=UserRole.contractor,
                full_name="Thread-only specialist",
                profile_code="ACL003",
            )
            outsider = User(
                id="acl-outsider",
                phone="+79990000204",
                role=UserRole.contractor,
                full_name="Outsider",
                profile_code="ACL004",
            )
            project = Project(
                id="acl-project",
                name="Thread-only ACL",
                renovation_type="cosmetic",
                customer_id=customer.id,
                contractor_id=contractor.id,
            )
            invited_thread = ChatThread(
                id="acl-thread-invited",
                project_id=project.id,
                title="Invited thread",
                created_by=customer.id,
            )
            sibling_thread = ChatThread(
                id="acl-thread-sibling",
                project_id=project.id,
                title="Sibling thread",
                created_by=customer.id,
            )
            db.add_all([
                customer,
                contractor,
                invited,
                outsider,
                project,
                invited_thread,
                sibling_thread,
            ])
            await db.flush()
            db.add(
                ChatThreadParticipant(
                    id="acl-participant",
                    thread_id=invited_thread.id,
                    user_id=invited.id,
                    profile_code=invited.profile_code,
                    invited_by=customer.id,
                    status="active",
                )
            )
            await db.commit()

            resolved_project, resolved_thread = await require_chat_access(
                db,
                project.id,
                invited_thread.id,
                invited,
                write=True,
                allow_participant=True,
            )
            assert resolved_project.id == project.id
            assert resolved_thread.id == invited_thread.id

            capabilities = await chats_api._chat_capabilities(
                db,
                project_id=project.id,
                user=invited,
            )
            assert capabilities == {
                "access_scope": "thread",
                "can_view_project_actions": False,
                "can_manage_participants": False,
                "can_create_task": False,
                "can_create_invoice": False,
            }

            # The same identity does not become a project writer merely because
            # it was invited to one chat.
            with pytest.raises(HTTPException) as project_write_denied:
                await require_chat_access(
                    db,
                    project.id,
                    invited_thread.id,
                    invited,
                    write=True,
                    allow_participant=False,
                )
            assert project_write_denied.value.status_code == 403

            # Exact-thread means exact-thread: no sibling-chat traversal.
            with pytest.raises(HTTPException) as sibling_denied:
                await require_chat_access(
                    db,
                    project.id,
                    sibling_thread.id,
                    invited,
                    write=True,
                    allow_participant=True,
                )
            assert sibling_denied.value.status_code == 403

            # `allow_participant` is not a bypass for unrelated identities.
            with pytest.raises(HTTPException) as outsider_denied:
                await require_chat_access(
                    db,
                    project.id,
                    invited_thread.id,
                    outsider,
                    write=True,
                    allow_participant=True,
                )
            assert outsider_denied.value.status_code == 403
    finally:
        await engine.dispose()
