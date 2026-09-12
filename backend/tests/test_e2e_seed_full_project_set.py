"""Review/E2E seed must materialize the complete canonical project set."""
from pathlib import Path


def test_e2e_seed_reconciles_complete_demo_project_set():
    root = Path(__file__).resolve().parents[2]
    e2e_seed = (root / "backend" / "app" / "e2e_seed.py").read_text(encoding="utf-8")
    demo_seed = (root / "backend" / "app" / "services" / "seed_demo.py").read_text(encoding="utf-8")

    assert e2e_seed.count("await ensure_demo_users(db)") >= 2
    assert '"full_project_set": True' in e2e_seed
    assert 'name="Демо-квартира, ул. Пример 12"' in demo_seed
    assert 'name="Демо-дом, дачный посёлок"' in demo_seed
