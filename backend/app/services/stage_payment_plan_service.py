"""Разнесение цены договора по этапам.

`Stage.payment_amount` заполнялся ровно один раз — при создании проекта из
мастера, долей от предполагаемого бюджета (`project_service`). Этапы,
добавленные позже, получали ноль (`stage_service`, `stage_mutation_service`),
а фиксация сметы суммы по этапам не разносила.

Платёж по этапу создаётся только при `payment_amount > 0`
(`accept_orchestrator`). Значит этап принимался, акт создавался, а денег не
возникало — молча. Сервер честно отдавал `payment_expected_on_accept: false`,
но показать это было некому.

Здесь считается разнесение по весам этапов — тем же весам, по которым уже
считается прогресс проекта (`stage_status_service.weighted_progress`).
Разнесение — умолчание, а не приговор: суммы правятся вручную.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StageWeight:
    """Этап для разнесения: чем он опознаётся и сколько весит."""

    stage_id: str
    weight: float


def _r2(value: float) -> float:
    return round(value + 0.0, 2)


def distribute_by_weight(total: float, stages: list[StageWeight]) -> dict[str, float]:
    """Разнести `total` по этапам пропорционально весам.

    Сумма долей **точно** равна `total`: остаток от округления отдаётся
    самому крупному этапу, а не теряется. Иначе порядок оплаты не сошёлся бы
    с ценой договора — ровно та беда, против которой эта правка.

    Когда весов нет вовсе (все нули), делим поровну: это честнее, чем отдать
    всё первому этапу или не разнести ничего.
    """
    if total <= 0 or not stages:
        return {}

    positive = [s for s in stages if s.weight > 0]
    basis = positive or stages
    weight_sum = sum(s.weight for s in basis)
    if weight_sum <= 0:
        # Равные доли: вес ни у кого не задан.
        share = total / len(basis)
        shares = {s.stage_id: _r2(share) for s in basis}
    else:
        shares = {s.stage_id: _r2(total * (s.weight / weight_sum)) for s in basis}

    # Остаток округления — самому крупному этапу. Он там наименее заметен, и
    # выбор детерминирован: при равных долях побеждает меньший идентификатор.
    remainder = _r2(total - sum(shares.values()))
    if remainder:
        target = max(shares, key=lambda sid: (shares[sid], [-ord(c) for c in sid]))
        shares[target] = _r2(shares[target] + remainder)

    # Этапы без веса при наличии взвешенных не получают ничего — но и не
    # пропадают из ответа: ноль здесь означает «платежа по этапу не будет».
    for stage in stages:
        shares.setdefault(stage.stage_id, 0.0)
    return shares


def plan_matches_total(total: float, amounts: list[float]) -> bool:
    """Сходится ли порядок оплаты с ценой договора."""
    return abs(_r2(sum(amounts)) - _r2(total)) < 0.01


def undistributed(total: float, amounts: list[float]) -> float:
    """Сколько из цены договора не разнесено по этапам."""
    return _r2(total - sum(amounts))


async def apply_plan_from_estimate(db, project_id: str) -> dict:
    """Разнести цену договора по этапам при фиксации сметы.

    Зовётся один раз — `lock_estimate` отказывает на уже зафиксированной
    смете, — и потому не затирает ручных правок: их делают после фиксации.

    Берём `budget_planned`: к этому моменту `recalc_budget` уже посчитал его
    как строки сметы плюс одобренные доп. работы, то есть это и есть цена
    договора.
    """
    from sqlalchemy import select

    from app.models.entities import Project, Stage

    project = await db.get(Project, project_id)
    if not project:
        return {"applied": False, "reason": "project_not_found"}

    total = float(project.budget_planned or 0)
    stages = list(
        (await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all()
    )
    if total <= 0 or not stages:
        return {"applied": False, "reason": "nothing_to_distribute", "total": total}

    shares = distribute_by_weight(
        total,
        [StageWeight(stage_id=s.id, weight=float(s.weight_coefficient or 0)) for s in stages],
    )
    for stage in stages:
        if stage.id in shares:
            stage.payment_amount = shares[stage.id]
    await db.flush()
    return {
        "applied": True,
        "total": _r2(total),
        "stages": len(shares),
        "distributed": _r2(sum(shares.values())),
    }
