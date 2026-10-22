"""Деньги за этап появляются, и порядок оплаты сходится с ценой договора.

Найдено сквозным прогоном цепочки «этап → деньги».

Платёж по этапу создаётся только при `Stage.payment_amount > 0`
(`accept_orchestrator`). Само поле заполнялось **ровно один раз** — при
создании проекта из мастера, долей от предполагаемого бюджета
(`project_service`). Этапы, заведённые позже, получали ноль
(`stage_service`, `stage_mutation_service`), а фиксация сметы суммы по
этапам не разносила.

Итог: этап принимается, акт создаётся, а денег не возникает — молча.
Сервер отдавал `payment_expected_on_accept: false`, но показать это было
некому.

На демо-объекте до правки: цена договора 194 437.70, разнесено по этапам
154 537.73, не разнесено **39 899.97** — почти сорок тысяч, которые
никогда не стали бы платежом.
"""
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
ESTIMATE_SERVICE = (ROOT / "app" / "services" / "estimate_service.py").read_text()
STAGE_ROUTES = (ROOT / "app" / "api" / "v1" / "stage_mutations.py").read_text()

DEMO_TOTAL = 194437.70


def _plan():
    """Модуль разнесения — импорт отложен намеренно.

    На исходном коде его нет, и импорт на уровне модуля ронял бы сбор тестов
    целиком. Тогда проверки по исходнику — про фиксацию и про ручку правки —
    не успевали бы сказать, что именно сломано.
    """
    from app.services import stage_payment_plan_service

    return stage_payment_plan_service


def StageWeight(*args, **kwargs):
    return _plan().StageWeight(*args, **kwargs)


def distribute_by_weight(*args, **kwargs):
    return _plan().distribute_by_weight(*args, **kwargs)


def plan_matches_total(*args, **kwargs):
    return _plan().plan_matches_total(*args, **kwargs)


def undistributed(*args, **kwargs):
    return _plan().undistributed(*args, **kwargs)


def test_shares_add_up_to_the_total_exactly():
    # Копейка, потерянная на округлении, — это порядок оплаты, не сходящийся
    # с ценой договора. Ровно та беда, против которой эта правка.
    stages = [StageWeight(f"s{i}", w) for i, w in enumerate([0.05, 0.08, 0.15, 0.2, 0.15, 0.25, 0.07, 0.05])]
    shares = distribute_by_weight(DEMO_TOTAL, stages)
    assert plan_matches_total(DEMO_TOTAL, list(shares.values()))
    assert round(sum(shares.values()), 2) == DEMO_TOTAL


def test_remainder_goes_to_the_largest_stage_not_nowhere():
    stages = [StageWeight("a", 1), StageWeight("b", 1), StageWeight("c", 1)]
    shares = distribute_by_weight(100.0, stages)
    assert round(sum(shares.values()), 2) == 100.0
    # Три равные доли по 33.33 дают 99.99; остаток обязан куда-то лечь.
    assert max(shares.values()) == 33.34


def test_remainder_target_is_deterministic():
    stages = [StageWeight("b", 1), StageWeight("a", 1), StageWeight("c", 1)]
    first = distribute_by_weight(100.0, stages)
    second = distribute_by_weight(100.0, list(reversed(stages)))
    assert first == second, "остаток ложится по-разному — результат зависит от порядка выборки"


def test_weights_are_respected():
    shares = distribute_by_weight(1000.0, [StageWeight("a", 1), StageWeight("b", 3)])
    assert shares["a"] == 250.0
    assert shares["b"] == 750.0


def test_without_weights_shares_are_equal_not_lost():
    # Отдать всё первому этапу или не разнести ничего — хуже, чем поровну.
    shares = distribute_by_weight(90.0, [StageWeight("a", 0), StageWeight("b", 0), StageWeight("c", 0)])
    assert sorted(shares.values()) == [30.0, 30.0, 30.0]


def test_stage_without_weight_among_weighted_gets_zero_not_absent():
    # Ноль здесь означает «платежа по этапу не будет», и это надо видеть.
    shares = distribute_by_weight(100.0, [StageWeight("a", 1), StageWeight("b", 0)])
    assert shares["b"] == 0.0
    assert shares["a"] == 100.0


def test_nothing_to_distribute_is_not_an_error():
    assert distribute_by_weight(0.0, [StageWeight("a", 1)]) == {}
    assert distribute_by_weight(100.0, []) == {}


def test_undistributed_is_a_number_not_a_flag():
    # «Не сходится» без суммы не говорит, насколько именно.
    assert undistributed(DEMO_TOTAL, [154537.73]) == 39899.97
    assert undistributed(100.0, [100.0]) == 0.0


def test_matching_tolerates_one_kopeck_of_rounding():
    assert plan_matches_total(100.0, [99.995]) is True
    assert plan_matches_total(100.0, [99.0]) is False


def test_lock_distributes_and_reports_it():
    """Фиксация сметы разносит суммы и говорит об этом в ответе."""
    block = ESTIMATE_SERVICE.split("async def lock_estimate")[1]
    assert "apply_plan_from_estimate" in block, "фиксация снова не разносит суммы по этапам"
    assert '"payment_plan": payment_plan' in block, "о разнесении не сказано в ответе"
    # Разносим после пересчёта бюджета: до него цена договора ещё не известна.
    assert block.index("recalc_budget") < block.index("apply_plan_from_estimate")


def test_manual_edit_route_exists_and_validates():
    source = STAGE_ROUTES
    assert '@router.get("/{project_id}/stages/payment-plan")' in source
    assert '@router.patch("/{project_id}/stages/payment-plan")' in source
    # Отрицательная сумма и чужой этап — то, что проверить обязаны.
    assert "negative_amount" in source
    assert "stage_not_found" in source
    # Правку разрешаем только тем, кто вправе менять объект.
    patch_block = source.split('@router.patch("/{project_id}/stages/payment-plan")')[1]
    assert "write=True" in patch_block


@pytest.mark.asyncio
async def test_apply_plan_on_missing_project_is_not_a_crash(db):
    from app.services.stage_payment_plan_service import apply_plan_from_estimate

    result = await apply_plan_from_estimate(db, "нет-такого-проекта")
    assert result["applied"] is False
    assert result["reason"] == "project_not_found"
