"""Чистка e2e-мусора в dev-БД под общим demo-заказчиком.

По умолчанию — только --dry-run: ничего не пишется, печатается список кандидатов.
Удаление происходит ТОЛЬКО с явным флагом --apply.

Что считается мусором (признаки e2e):
  * проекты: name совпадает с e2e-шаблоном (Room Lifecycle, CO Lifecycle, E2E ..., Contractor
    Authority, Chat retry object, Wizard Test ...) ИЛИ address начинается с «E2E»
    (этот маркер ставят все e2e-specs и helpers.ts);
  * чаты в проектах, которые мусором не являются: точный title «E2E», «UAT checklist»
    или «E2E ...» (напр. «E2E retry thread»);
  * уведомления, привязанные к проектам-кандидатам (удаляются каскадом вместе с проектом).

Что никогда не трогается (канонические демо-данные):
  * проекты, имя которых начинается с «Демо-» («Демо-квартира…», «Демо-дом…»);
  * канонические чаты демо (seed_demo.APT_DEMO_CHATS / HOUSE_DEMO_CHATS);
  * чаты work:<id> и любые чаты, не подходящие под точные e2e-заголовки;
  * проекты не демо-пользователей (если не передан --any-owner).

--apply: проекты без финансовой истории/подписанных документов/legal hold удаляются
физически (как «очистка корзины»); заблокированные уходят в корзину (trashed_at) и
помечаются в отчёте. Чаты-кандидаты удаляются вместе с сообщениями.

Запуск (из каталога backend):
  env -u ENVIRONMENT .venv/bin/python -m scripts.cleanup_e2e_demo_data            # dry-run
  env -u ENVIRONMENT .venv/bin/python -m scripts.cleanup_e2e_demo_data --apply
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.engine import make_url

E2E_PROJECT_NAME_RE = re.compile(
    r"^(Room Lifecycle|CO Lifecycle|E2E\b|Contractor Authority|Chat retry object|Wizard Test)",
    re.IGNORECASE,
)
E2E_ADDRESS_PREFIX = "e2e"
CANONICAL_PROJECT_PREFIX = "демо-"
E2E_CHAT_RE = re.compile(r"^(UAT checklist|E2E)(\s.*)?$", re.IGNORECASE)


@dataclass
class Candidates:
    projects: list[tuple[str, str, str | None, datetime | None]] = field(default_factory=list)
    chats: list[tuple[str, str, str]] = field(default_factory=list)  # id, title, project name
    notifications_by_project: Counter = field(default_factory=Counter)
    skipped_canonical: list[str] = field(default_factory=list)


def is_canonical_project(name: str | None) -> bool:
    return (name or "").strip().lower().startswith(CANONICAL_PROJECT_PREFIX)


def is_e2e_project(name: str | None, address: str | None) -> bool:
    if is_canonical_project(name):
        return False
    if E2E_PROJECT_NAME_RE.match((name or "").strip()):
        return True
    return (address or "").strip().lower().startswith(E2E_ADDRESS_PREFIX)


def is_e2e_chat_title(title: str | None) -> bool:
    return bool(E2E_CHAT_RE.match((title or "").strip()))


async def collect(db, *, any_owner: bool) -> Candidates:
    from app.models.entities import AppNotification, ChatThread, Project, User
    from app.services.seed_demo import APT_DEMO_CHATS, DEMO_PHONES, HOUSE_DEMO_CHATS

    canonical_chats = {t.strip().lower() for t in (*APT_DEMO_CHATS, *HOUSE_DEMO_CHATS)}
    out = Candidates()

    stmt = select(Project.id, Project.name, Project.address, Project.trashed_at, Project.customer_id)
    if not any_owner:
        demo_ids = (await db.execute(select(User.id).where(User.phone.in_(list(DEMO_PHONES.values()))))).scalars().all()
        stmt = stmt.where(Project.customer_id.in_(demo_ids or ["__none__"]))
    rows = (await db.execute(stmt.order_by(Project.created_at))).all()

    candidate_ids: set[str] = set()
    non_candidate: dict[str, str] = {}
    for pid, name, address, trashed_at, _owner in rows:
        if is_canonical_project(name):
            out.skipped_canonical.append(name)
            non_candidate[pid] = name
        elif is_e2e_project(name, address):
            out.projects.append((pid, name, address, trashed_at))
            candidate_ids.add(pid)
        else:
            non_candidate[pid] = name

    if non_candidate:
        threads = (
            await db.execute(
                select(ChatThread.id, ChatThread.title, ChatThread.project_id).where(
                    ChatThread.project_id.in_(list(non_candidate))
                )
            )
        ).all()
        for tid, title, pid in threads:
            if (title or "").strip().lower() in canonical_chats:
                continue
            if is_e2e_chat_title(title):
                out.chats.append((tid, title, non_candidate[pid]))

    if candidate_ids:
        notif_rows = (
            await db.execute(
                select(AppNotification.project_id, func.count())
                .where(AppNotification.project_id.in_(list(candidate_ids)))
                .group_by(AppNotification.project_id)
            )
        ).all()
        out.notifications_by_project = Counter({pid: n for pid, n in notif_rows})
    return out


def print_report(c: Candidates, *, apply: bool) -> None:
    mode = "APPLY" if apply else "DRY-RUN (ничего не изменено)"
    print(f"== cleanup_e2e_demo_data: {mode} ==")
    print(f"Канонические проекты (не трогаем): {len(c.skipped_canonical)}")
    for name in c.skipped_canonical:
        print(f"  KEEP  {name}")
    by_kind = Counter(re.sub(r"\s+(\d.*|dbg)$", "", n).strip() or n for _, n, _a, _t in c.projects)
    print(f"\nПроекты-кандидаты: {len(c.projects)}")
    for kind, n in sorted(by_kind.items(), key=lambda kv: -kv[1]):
        print(f"  {n:>3} x {kind}")
    for pid, name, address, trashed_at in c.projects:
        t = " [в корзине]" if trashed_at else ""
        print(f"  - {pid}  {name!r}  addr={address!r}{t}")
    print(f"\nЧаты-кандидаты в не-мусорных проектах: {len(c.chats)}")
    by_title = Counter(t for _, t, _p in c.chats)
    for title, n in by_title.most_common():
        print(f"  {n:>3} x {title!r}")
    total_notifs = sum(c.notifications_by_project.values())
    print(f"\nУведомления, привязанные к проектам-кандидатам (уйдут каскадом): {total_notifs}")


async def apply_cleanup(db, c: Candidates) -> None:
    from app.core.timeutil import utc_now
    from app.models.entities import ChatThread, Project
    from app.services import project_service as ps

    ids = [p[0] for p in c.projects]
    purgeable: list[str] = []
    trashed_only: list[str] = []
    if ids:
        held = await ps._legal_held_project_ids(db, ids)
        blockers = await ps._purge_blockers(db, [i for i in ids if i not in held])
        for pid in ids:
            (trashed_only if pid in held or pid in blockers else purgeable).append(pid)

    if purgeable:
        await ps._delete_purgeable_project_documents(db, purgeable)
        await db.execute(delete(Project).where(Project.id.in_(purgeable)))
    if trashed_only:
        await db.execute(
            Project.__table__.update()
            .where(Project.id.in_(trashed_only), Project.trashed_at.is_(None))
            .values(trashed_at=utc_now())
        )
    chat_ids = [t[0] for t in c.chats]
    if chat_ids:
        # ORM delete: каскад на сообщения/реакции
        for thread in (await db.execute(select(ChatThread).where(ChatThread.id.in_(chat_ids)))).scalars():
            await db.delete(thread)
    await db.commit()
    if purgeable:
        await ps._cleanup_project_storage(purgeable)
    print(
        f"\nПрименено: удалено проектов {len(purgeable)}, в корзину (финансовая история/подписи/legal hold) "
        f"{len(trashed_only)}, удалено чатов {len(chat_ids)}."
    )


async def main_async(args: argparse.Namespace) -> int:
    from app.core.config import settings
    from app.db.session import SessionLocal, engine

    url = make_url(settings.database_url)
    print(f"База: {url.render_as_string(hide_password=True)}")
    try:
        async with SessionLocal() as db:
            cands = await collect(db, any_owner=args.any_owner)
            print_report(cands, apply=args.apply)
            if not args.apply:
                await db.rollback()
                print("\nЭто dry-run. Для удаления запустите с --apply.")
                return 0
            await apply_cleanup(db, cands)
            return 0
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="только перечислить кандидатов (по умолчанию)")
    mode.add_argument("--apply", action="store_true", help="реально удалить кандидатов")
    parser.add_argument("--any-owner", action="store_true", help="не ограничивать проекты demo-пользователями")
    args = parser.parse_args(argv)
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
