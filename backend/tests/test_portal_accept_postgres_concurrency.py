"""Real PostgreSQL race: single portal capability, one acceptance and effect set."""
from __future__ import annotations

import asyncio
import os

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.api.v1.portal_acceptance_decisions import (
    PortalAcceptanceDecisionIn,
    portal_accept_work,
)
from app.models.entities import DomainOutbox, PortalLink, WorkAcceptance
from app.services import outbox_inline_dispatch, portal_link_service
from app.services import work_acceptance_decision_service as decisions
from tests.test_work_acceptance_decision_integrity import seed_acceptance_stage


@pytest.mark.asyncio
async def test_two_replicas_cannot_spend_same_portal_acceptance_capability(monkeypatch):
    url = os.environ.get("PORTAL_ACCEPT_POSTGRES_URL", "").strip()
    if not url:
        pytest.skip("PORTAL_ACCEPT_POSTGRES_URL requires the dedicated migrated PostgreSQL CI step")

    async def no_inline(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(outbox_inline_dispatch, "dispatch_best_effort", no_inline)
    engine = create_async_engine(url)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with Session() as db:
            customer, contractor, _, project, _, stage, _ = (
                await seed_acceptance_stage(db, "portal-atomic-race")
            )
            requested, error = await decisions.request_acceptance(
                db, project=project, stage_id=stage.id, actor=contractor,
            )
            assert error is None and requested is not None
            acceptance_id = requested.acceptance.id
            project_id = project.id
            link, token = await portal_link_service.issue_link(
                db, project_id=project_id, user_id=customer.id,
                issued_by=customer.id,
                scopes=["read", "accept_stage", "pay", "sign_document"],
            )
            link_id = link.id

        async def decide_once():
            async with Session() as db:
                try:
                    result = await portal_accept_work(
                        project_id, acceptance_id,
                        PortalAcceptanceDecisionIn(token=token, comment="race"),
                        db=db,
                    )
                    return ("ok", result["status"])
                except HTTPException as exc:
                    await db.rollback()
                    return ("error", exc.status_code, exc.detail)

        results = await asyncio.wait_for(
            asyncio.gather(decide_once(), decide_once()), timeout=30,
        )
        assert sum(v[0] == "ok" for v in results) == 1, results
        assert ("error", 410, "portal_decision_already_used") in results

        async with Session() as db:
            link = await db.get(PortalLink, link_id)
            assert link is not None
            assert link.accept_stage_consumed_at is not None
            assert link.accept_stage_acceptance_id == acceptance_id
            assert link.accept_stage_decision == "accept"
            assert link.revoked_at is None
            assert {"read", "pay", "sign_document"}.issubset(set(link.scopes.split(",")))
            accepted = await db.get(WorkAcceptance, acceptance_id)
            assert accepted is not None
            assert accepted.status in {"accepted", "accepted_with_remarks"}
            events = await db.scalar(
                select(func.count()).select_from(DomainOutbox).where(
                    DomainOutbox.aggregate_type == "work_acceptance",
                    DomainOutbox.aggregate_id == acceptance_id,
                    DomainOutbox.event_type == "acceptance.side_effects",
                )
            )
            assert events == 1
    finally:
        await engine.dispose()
