from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_material_delivery_does_not_manufacture_execution_truth():
    source = (ROOT / "app/services/dependency_service.py").read_text(encoding="utf-8")
    material_handler = source.split("async def on_material_delivered", 1)[1]

    assert 'dependency.status = "satisfied"' in material_handler
    assert 'evaluation["blocked"]' in material_handler
    assert "stage.status = StageStatus.active" not in material_handler
    assert "stage.actual_start =" not in material_handler


def test_canonical_start_retains_authority_contract():
    source = (ROOT / "app/services/stage_mutation_service.py").read_text(encoding="utf-8")

    assert "_require_execution_actor(project, stage, actor)" in source
    assert "project_contract_gate(db, project.id)" in source
    assert "dependency_service.evaluate_stage" in source
    assert "stage.status = StageStatus.active" in source
    assert "stage.actual_start" in source
