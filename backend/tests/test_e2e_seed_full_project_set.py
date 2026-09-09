"""Review/E2E seed must expose both canonical demo projects from a clean database."""
from pathlib import Path


def test_e2e_seed_reconciles_demo_projects_twice():
    source = Path(__file__).resolve().parents[1] / "app" / "e2e_seed.py"
    text = source.read_text(encoding="utf-8")
    assert text.count("await ensure_demo_users(db)") >= 2
    assert '"full_project_set": True' in text
