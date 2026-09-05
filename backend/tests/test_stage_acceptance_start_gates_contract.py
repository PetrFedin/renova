"""P0 #301: acceptance must never manufacture an authoritative stage start."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCEPTANCE = ROOT / "app" / "services" / "accept_orchestrator.py"
CANONICAL_START = ROOT / "app" / "services" / "stage_mutation_service.py"


def test_acceptance_does_not_mutate_next_stage_to_active():
    source = ACCEPTANCE.read_text(encoding="utf-8")
    assert "next_stage.status = StageStatus.active" not in source
    assert "next_stage.actual_start" not in source
    assert "Следующий этап готов к запуску" in source
    assert "Этап автоматически переведён в работу" not in source


def test_canonical_start_retains_execution_contract_and_dependency_gates():
    source = CANONICAL_START.read_text(encoding="utf-8")
    assert "_require_execution_actor(project, stage, actor)" in source
    assert "project_contract_gate(db, project.id)" in source
    assert "dependency_service.evaluate_stage" in source
    assert "stage.status = StageStatus.active" in source
    assert "stage.actual_start = date.today()" in source
