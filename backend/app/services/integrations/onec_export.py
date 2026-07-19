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


def _xml_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


async def build_1c_payments_xml(db: AsyncSession, project: Project) -> str:
    """P4.1a+: XML-обмен для 1С (ручной импорт). Не CommerceML full — компактный RenovaExchange."""
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
    pname = _xml_escape(project.name or project.id)
    exported = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<RenovaExchange version="1.0" exported_at="{exported}" project_id="{_xml_escape(project.id)}">',
        f"  <Project><Name>{pname}</Name></Project>",
        "  <Documents>",
    ]
    for p in payments:
        st = p.status.value if hasattr(p.status, "value") else str(p.status)
        pt = p.payment_type.value if hasattr(p.payment_type, "value") else str(p.payment_type)
        dt = (p.confirmed_at or p.created_at).isoformat(timespec="seconds")
        parts.append(
            "    <Document>"
            f"<Type>payment</Type>"
            f"<PaymentType>{_xml_escape(pt)}</PaymentType>"
            f"<Id>{_xml_escape(p.id)}</Id>"
            f"<Title>{_xml_escape(p.title or '')}</Title>"
            f"<Amount>{p.amount:.2f}</Amount>"
            f"<Status>{_xml_escape(st)}</Status>"
            f"<Date>{dt}</Date>"
            f"<YooKassaId>{_xml_escape(p.yookassa_payment_id or '')}</YooKassaId>"
            f"<Comment>{_xml_escape((p.notes or '')[:200])}</Comment>"
            "</Document>"
        )
    for co in cos:
        st = co.status.value if hasattr(co.status, "value") else str(co.status)
        parts.append(
            "    <Document>"
            f"<Type>change_order</Type>"
            f"<Id>{_xml_escape(co.id)}</Id>"
            f"<Title>{_xml_escape(co.title or '')}</Title>"
            f"<Amount>{co.amount:.2f}</Amount>"
            f"<Status>{_xml_escape(st)}</Status>"
            f"<Date>{co.created_at.isoformat(timespec='seconds')}</Date>"
            f"<Comment>{_xml_escape((co.description or '')[:200])}</Comment>"
            "</Document>"
        )
    parts.append("  </Documents>")
    parts.append("</RenovaExchange>")
    return "\n".join(parts) + "\n"



async def build_1c_commerceml_xml(db: AsyncSession, project: Project) -> str:
    """P4.1a++: подмножество CommerceML 2.04 (Документ/Оплата) для ручного импорта в 1С."""
    payments = (
        await db.execute(
            select(Payment).where(Payment.project_id == project.id).order_by(Payment.created_at.asc())
        )
    ).scalars().all()
    formed = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    pname = _xml_escape(project.name or project.id)
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<КоммерческаяИнформация ВерсияСхемы="2.04" ДатаФормирования="{formed}">',
    ]
    for i, p in enumerate(payments, start=1):
        st = p.status.value if hasattr(p.status, "value") else str(p.status)
        pt = p.payment_type.value if hasattr(p.payment_type, "value") else str(p.payment_type)
        dt = (p.confirmed_at or p.created_at).strftime("%Y-%m-%d")
        parts.append("  <Документ>")
        parts.append(f"    <Ид>{_xml_escape(p.id)}</Ид>")
        parts.append(f"    <Номер>{i}</Номер>")
        parts.append(f"    <Дата>{dt}</Дата>")
        parts.append("    <ХозОперация>Оплата</ХозОперация>")
        parts.append("    <Роль>Продавец</Роль>")
        parts.append(f"    <Валюта>руб</Валюта>")
        parts.append(f"    <Курс>1</Курс>")
        parts.append(f"    <Сумма>{p.amount:.2f}</Сумма>")
        parts.append(f"    <Комментарий>{_xml_escape(f'{pname} · {p.title} · {pt} · {st}')}</Комментарий>")
        if p.yookassa_payment_id:
            parts.append(
                f"    <ЗначенияРеквизитов><ЗначениеРеквизита>"
                f"<Наименование>ЮKassaId</Наименование>"
                f"<Значение>{_xml_escape(p.yookassa_payment_id)}</Значение>"
                f"</ЗначениеРеквизита></ЗначенияРеквизитов>"
            )
        parts.append("  </Документ>")
    parts.append("</КоммерческаяИнформация>")
    return "\n".join(parts) + "\n"
