"""Экспорт для 1С и банковского реестра — CSV с `;` (RU Excel)."""
from __future__ import annotations

import csv
import io
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import ChangeOrder, Payment, Project


def _buf() -> io.StringIO:
    # BOM для Excel RU
    b = io.StringIO()
    b.write("\ufeff")
    return b


async def build_1c_payments_csv(db: AsyncSession, project: Project) -> str:
    """Платежи + доп. работы — для загрузки в 1С (ручной импорт CSV)."""
    payments = (
        await db.execute(
            select(Payment).where(Payment.project_id == project.id).order_by(Payment.created_at.asc())
        )
    ).scalars().all()
    cos = (
        await db.execute(
            select(ChangeOrder).where(ChangeOrder.project_id == project.id).order_by(ChangeOrder.created_at.asc())
        )
    ).scalars().all()

    buf = _buf()
    w = csv.writer(buf, delimiter=";")
    w.writerow(
        [
            "Тип",
            "ID",
            "Проект",
            "Название",
            "Сумма",
            "Статус",
            "Дата",
            "YuKassaID",
            "Комментарий",
        ]
    )
    pname = project.name or project.id
    for p in payments:
        st = p.status.value if hasattr(p.status, "value") else str(p.status)
        pt = p.payment_type.value if hasattr(p.payment_type, "value") else str(p.payment_type)
        w.writerow(
            [
                f"payment:{pt}",
                p.id,
                pname,
                p.title,
                f"{p.amount:.2f}",
                st,
                (p.confirmed_at or p.created_at).isoformat(timespec="seconds"),
                p.yookassa_payment_id or "",
                (p.notes or "")[:200],
            ]
        )
    for co in cos:
        st = co.status.value if hasattr(co.status, "value") else str(co.status)
        w.writerow(
            [
                "change_order",
                co.id,
                pname,
                co.title,
                f"{co.amount:.2f}",
                st,
                co.created_at.isoformat(timespec="seconds"),
                "",
                (co.description or "")[:200],
            ]
        )
    return buf.getvalue()


async def build_bank_register_csv(db: AsyncSession, project: Project) -> str:
    """Реестр оплат для бухгалтера / сверки с выпиской банка."""
    payments = (
        await db.execute(
            select(Payment).where(Payment.project_id == project.id).order_by(Payment.created_at.asc())
        )
    ).scalars().all()
    buf = _buf()
    w = csv.writer(buf, delimiter=";")
    w.writerow(
        [
            "Дата",
            "Назначение",
            "Сумма",
            "Статус",
            "Тип",
            "ID_счёта",
            "Проект",
            "Экспорт_at",
        ]
    )
    exported = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    pname = project.name or project.id
    for p in payments:
        st = p.status.value if hasattr(p.status, "value") else str(p.status)
        pt = p.payment_type.value if hasattr(p.payment_type, "value") else str(p.payment_type)
        w.writerow(
            [
                (p.confirmed_at or p.created_at).date().isoformat(),
                p.title,
                f"{p.amount:.2f}",
                st,
                pt,
                p.id,
                pname,
                exported,
            ]
        )
    return buf.getvalue()
