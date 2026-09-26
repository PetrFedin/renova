"""Договор подряда как документ с содержанием, а не как пустой бланк.

`ensure_contract_draft` создавала документ с одним заголовком: ни суммы, ни
сторон, ни предмета, ни файла. При этом такой документ **можно подписать**, а
подпись снимает гейт начала работ (`project_contract_gate` →
`stage_service.start_stage`).

То есть защита «работы не начнутся без договора» удовлетворялась подписью под
чистым листом. Заказчик подписывал пустоту и считал, что подписал договор.

Здесь собирается содержание договора из того, что к моменту фиксации сметы
уже известно: стороны, объект, предмет, сумма, НДС, состав работ и
материалов, порядок оплаты по этапам.

Файл не хранится: договор рисуется ручкой `GET /projects/{id}/contract.pdf`
по требованию — тем же способом, что и акт приёмки
(`ensure_acceptance_act_document`). Так документ всегда отражает текущее
состояние сметы, а не слепок, снятый неизвестно когда.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import (
    ChangeOrder,
    ChangeOrderStatus,
    ContractorProfile,
    EstimateLine,
    LineType,
    Project,
    Stage,
    User,
)


def contract_href(project_id: str) -> str:
    """Адрес, по которому договор рисуется. Тот же приём, что у акта приёмки."""
    return f"/api/v1/projects/{project_id}/contract.pdf"


@dataclass
class ContractTerms:
    """Существенные условия договора — то, без чего подписывать нечего."""

    project_name: str
    address: str | None
    customer: str
    contractor: str | None
    works_total: float
    materials_total: float
    works_count: int
    materials_count: int
    #: Одобренные доп. работы. Входят в цену договора: заказчик их согласовал,
    #: и `budget_planned` на сервере их уже учитывает.
    change_orders_total: float
    change_orders_count: int
    vat_rate: float
    locked_at: str | None
    stages: list[tuple[str, float]] = field(default_factory=list)

    @property
    def vat_label(self) -> str:
        return "Без НДС" if not self.vat_rate else f"НДС {self.vat_rate:g}%"

    @property
    def estimate_total(self) -> float:
        """Только строки сметы, без доп. работ."""
        return round(self.works_total + self.materials_total, 2)

    @property
    def total(self) -> float:
        """Цена договора. Вычисляется, а не хранится.

        Отдельным полем она могла разойтись со слагаемыми — ровно та беда,
        из-за которой экран сметы показывает одно число, а разбивка под ним
        даёт другое.
        """
        return round(self.estimate_total + self.change_orders_total, 2)

    @property
    def scheduled_payments(self) -> float:
        return round(sum(amount for _, amount in self.stages), 2)

    def is_signable(self) -> bool:
        """Подписывать можно только то, у чего есть предмет и цена.

        Договор на ноль рублей или без единой строки сметы — не договор.
        """
        return self.total > 0 and (self.works_count + self.materials_count) > 0


def _person(user: User | None, profile: ContractorProfile | None = None) -> str | None:
    if profile is not None and (profile.company_name or "").strip():
        return profile.company_name.strip()
    if user is None:
        return None
    return (user.full_name or user.phone or "").strip() or None


async def collect_terms(db: AsyncSession, project_id: str) -> ContractTerms | None:
    """Собрать условия договора. `None` — проекта нет."""
    project = await db.get(Project, project_id)
    if not project:
        return None

    lines = list(
        (await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id)))
        .scalars()
        .all()
    )
    works: list[EstimateLine] = []
    materials: list[EstimateLine] = []
    for line in lines:
        # `line_type` — перечисление LineType (material | work); у значения
        # может не быть `.value`, если строка пришла как строка.
        raw = getattr(line, "line_type", None)
        kind = str(getattr(raw, "value", raw) or "").lower()
        (materials if kind == LineType.material.value else works).append(line)

    def amount(rows: list[EstimateLine]) -> float:
        return round(sum((row.quantity_planned or 0) * (row.unit_price or 0) for row in rows), 2)

    customer = await db.get(User, project.customer_id) if project.customer_id else None
    contractor = await db.get(User, project.contractor_id) if project.contractor_id else None
    profile = None
    if project.contractor_id:
        profile = (
            await db.execute(
                select(ContractorProfile).where(ContractorProfile.user_id == project.contractor_id)
            )
        ).scalar_one_or_none()

    stages = list(
        (await db.execute(select(Stage).where(Stage.project_id == project_id)))
        .scalars()
        .all()
    )
    stages.sort(key=lambda s: getattr(s, "sort_order", 0) or 0)

    works_amount = amount(works)
    materials_amount = amount(materials)

    # Одобренные доп. работы — часть цены договора. Без них договор называл бы
    # сумму меньше той, что показывает приложение и хранит `budget_planned`.
    approved = list(
        (
            await db.execute(
                select(ChangeOrder).where(
                    ChangeOrder.project_id == project_id,
                    ChangeOrder.status == ChangeOrderStatus.approved,
                )
            )
        )
        .scalars()
        .all()
    )
    change_orders_amount = round(sum(float(order.amount or 0) for order in approved), 2)

    return ContractTerms(
        project_name=project.name or "Объект",
        address=(project.address or "").strip() or None,
        customer=_person(customer) or "Заказчик",
        contractor=_person(contractor, profile),
        works_total=works_amount,
        materials_total=materials_amount,
        works_count=len(works),
        materials_count=len(materials),
        change_orders_total=change_orders_amount,
        change_orders_count=len(approved),
        vat_rate=float(project.vat_rate or 0),
        locked_at=project.estimate_locked_at.date().isoformat() if project.estimate_locked_at else None,
        # Этапы с нулевой суммой в порядок оплаты не попадают — платить по ним
        # нечего, и обещать обратное было бы неправдой.
        stages=[(s.name or "Этап", float(s.payment_amount or 0)) for s in stages if (s.payment_amount or 0) > 0],
    )


def contract_notes(terms: ContractTerms) -> str:
    """Короткая сводка в карточке документа — видно без открытия PDF."""
    parts = [f"Сумма: {terms.total:,.0f} ₽".replace(",", " "), terms.vat_label]
    if terms.contractor:
        parts.append(f"Исполнитель: {terms.contractor}")
    if terms.locked_at:
        parts.append(f"Смета зафиксирована {terms.locked_at}")
    return " · ".join(parts)
