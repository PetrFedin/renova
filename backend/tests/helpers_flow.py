"""Shared test helpers for W57 estimate lock and full-checklist acceptance."""
from __future__ import annotations

from httpx import AsyncClient, Response


async def complete_stage_checklist(
    client: AsyncClient,
    project_id: str,
    stage_id: str,
    headers: dict,
) -> list[dict]:
    """Mark all stage checklist items done (policy → quick; portal accept works)."""
    wf = (
        await client.get(
            f"/api/v1/projects/{project_id}/stages/{stage_id}/workflow",
            headers=headers,
        )
    ).json()
    items = wf.get("checklist") or []
    for item in items:
        iid = item.get("id")
        if not iid or item.get("done"):
            continue
        r = await client.post(
            f"/api/v1/projects/{project_id}/stages/{stage_id}/checklist/toggle",
            headers=headers,
            json={"item_id": iid, "done": True},
        )
        assert r.status_code == 200, r.text
    return items


async def accept_checklist_ids(
    client: AsyncClient,
    project_id: str,
    stage_id: str,
    headers: dict,
) -> list[str]:
    """Checklist item ids for AcceptanceDecisionIn when items are still open."""
    wf = (
        await client.get(
            f"/api/v1/projects/{project_id}/stages/{stage_id}/workflow",
            headers=headers,
        )
    ).json()
    return [str(i["id"]) for i in (wf.get("checklist") or []) if i.get("id")]


async def lock_estimate_w57(
    client: AsyncClient,
    project_id: str,
    h_cont: dict,
    h_cust: dict,
) -> Response:
    """W57: contractor propose-lock → customer lock."""
    proposed = await client.post(
        f"/api/v1/projects/{project_id}/estimate/propose-lock",
        headers=h_cont,
    )
    assert proposed.status_code == 200, proposed.text
    locked = await client.post(
        f"/api/v1/projects/{project_id}/estimate/lock",
        headers=h_cust,
    )
    assert locked.status_code == 200, locked.text
    return locked


async def self_assign(client, project_id: str, contractor_headers: dict) -> None:
    """Contractor claims the project and its customer confirms (owner decision).

    ``POST /assign`` no longer assigns: it opens a request that only the
    customer can accept. Fixtures that need a lead go through the real flow.
    """
    from sqlalchemy import select

    from app.db import session as sess
    from app.models.entities import Project

    resp = await client.post(f"/api/v1/projects/{project_id}/assign", headers=contractor_headers)
    if resp.status_code == 200:  # already the lead
        return
    assert resp.status_code == 202, resp.text
    request_id = resp.json()["request"]["id"]
    async with sess.SessionLocal() as db:
        customer_id = await db.scalar(select(Project.customer_id).where(Project.id == project_id))
    accepted = await client.post(
        f"/api/v1/projects/{project_id}/assignment-requests/{request_id}/accept",
        headers={"X-User-Id": customer_id},
    )
    assert accepted.status_code == 200, accepted.text
