"""Acceptance policy: quick vs full checklist (P1.15).

- quick: photos only (no pending checklist items)
- full: stage checklist has undone items — must accept via stage fold with checklist

Inline hub accept is only allowed for quick.
"""
from __future__ import annotations

from typing import Literal

from app.models.entities import Stage
from app.services import workflow_service as wf

AcceptancePolicy = Literal["quick", "full"]


def stage_checklist_items(stage: Stage) -> list[dict]:
    return wf.stage_checklist(stage)


def resolve_acceptance_policy(stage: Stage) -> AcceptancePolicy:
    items = stage_checklist_items(stage)
    if any(not i.get("done") for i in items):
        return "full"
    return "quick"


def assert_accept_policy(
    stage: Stage,
    *,
    checklist: list[str] | None,
    source: str = "api",
) -> AcceptancePolicy:
    """Raise ValueError: checklist_required | checklist_incomplete."""
    policy = resolve_acceptance_policy(stage)
    if policy == "quick":
        return policy

    if source == "inline":
        # Hub list must open stage detail for full checklist
        raise ValueError("checklist_required")

    items = stage_checklist_items(stage)
    required_ids = []
    required_texts = []
    for i in items:
        if i.get("done"):
            continue
        rid = str(i.get("id") or "").strip()
        text = str(i.get("text") or i.get("title") or "").strip()
        if rid:
            required_ids.append(rid)
        if text:
            required_texts.append(text)

    if not checklist:
        raise ValueError("checklist_required")
    provided = {str(x).strip() for x in checklist if str(x).strip()}
    if required_ids and not all(r in provided for r in required_ids):
        # allow matching by text labels
        if not all(t in provided for t in required_texts):
            raise ValueError("checklist_incomplete")
    elif required_texts and not all(t in provided for t in required_texts):
        raise ValueError("checklist_incomplete")
    return policy


def policy_dict(stage: Stage) -> dict:
    items = stage_checklist_items(stage)
    policy = resolve_acceptance_policy(stage)
    return {
        "policy": policy,
        "checklist_total": len(items),
        "checklist_done": sum(1 for i in items if i.get("done")),
        "inline_accept_allowed": policy == "quick",
    }
