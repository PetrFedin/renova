"""Черновик проекта — быстрые заметки с чеклистами и превращением в задачи."""
import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ScratchpadLine

CHECKLIST_OPEN = re.compile(r"^(\-\s*)?\[\s*\]\s*", re.I)
CHECKLIST_DONE = re.compile(r"^(\-\s*)?\[x\]\s*", re.I)
PURCHASE = re.compile(r"^(🛒|#покупк|#buy)\s*", re.I)


def parse_scratchpad_input(raw: str) -> tuple[str, str, bool]:
    s = raw.strip()
    if not s:
        return "", "note", False
    done = False
    m = CHECKLIST_DONE.match(s)
    if m:
        done = True
        s = s[m.end():].strip()
        return s or "Пункт", "checklist", True
    m = CHECKLIST_OPEN.match(s)
    if m:
        s = s[m.end():].strip()
        return s or "Пункт", "checklist", False
    m = PURCHASE.match(s)
    if m:
        s = s[m.end():].strip()
        return s or "Покупка", "purchase", False
    return s, "note", False


def line_dict(l: ScratchpadLine) -> dict:
    return {
        "id": l.id,
        "project_id": l.project_id,
        "text": l.text,
        "line_kind": l.line_kind,
        "done": l.done,
        "promoted_kind": l.promoted_kind,
        "promoted_id": l.promoted_id,
        "sort_order": l.sort_order,
        "created_at": l.created_at.isoformat() if l.created_at else None,
        "updated_at": l.updated_at.isoformat() if l.updated_at else None,
    }


async def list_lines(db: AsyncSession, project_id: str) -> list[dict]:
    rows = (
        await db.execute(
            select(ScratchpadLine)
            .where(ScratchpadLine.project_id == project_id)
            .order_by(ScratchpadLine.sort_order, ScratchpadLine.created_at)
        )
    ).scalars().all()
    return [line_dict(r) for r in rows]


async def create_line(db: AsyncSession, project_id: str, user_id: str, raw: str) -> dict:
    text, kind, done = parse_scratchpad_input(raw)
    if not text:
        raise ValueError("empty")
    last = (
        await db.execute(
            select(ScratchpadLine.sort_order)
            .where(ScratchpadLine.project_id == project_id)
            .order_by(ScratchpadLine.sort_order.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    order = (last or 0) + 1
    line = ScratchpadLine(
        project_id=project_id,
        text=text,
        line_kind=kind,
        done=done,
        sort_order=order,
        created_by=user_id,
    )
    db.add(line)
    await db.flush()
    await db.refresh(line)
    return line_dict(line)


async def update_line(db: AsyncSession, line: ScratchpadLine, patch: dict) -> ScratchpadLine:
    if "text" in patch and patch["text"] is not None:
        text, kind, done = parse_scratchpad_input(patch["text"])
        line.text = text or line.text
        line.line_kind = kind
        if patch.get("done") is None:
            line.done = done
    if "done" in patch and patch["done"] is not None:
        line.done = bool(patch["done"])
    if "promoted_kind" in patch:
        line.promoted_kind = patch["promoted_kind"]
    if "promoted_id" in patch:
        line.promoted_id = patch["promoted_id"]
    await db.flush()
    await db.refresh(line)
    return line


async def get_line(db: AsyncSession, line_id: str) -> ScratchpadLine | None:
    return (await db.execute(select(ScratchpadLine).where(ScratchpadLine.id == line_id))).scalar_one_or_none()


async def delete_line(db: AsyncSession, line: ScratchpadLine) -> None:
    await db.delete(line)
