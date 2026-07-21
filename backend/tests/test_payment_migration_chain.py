"""Payment evidence migration chain — avoid dual alembic heads with warranty.

When both w5warranty01 and w6payev01 exist in the tree, w6 MUST revise w5
(not w4). Standalone #27 against main revises w4 until #26 is merged;
PRE-MERGE step rebases down_revision — see docs/PORTAL-PAYMENT-EVIDENCE.md.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = ROOT / "alembic" / "versions"


def _read(name: str) -> str:
    return (VERSIONS / name).read_text(encoding="utf-8")


def test_w6_exists():
    assert (VERSIONS / "w6payev01_payment_evidence.py").is_file()


def test_no_dual_heads_when_warranty_present():
    w5 = VERSIONS / "w5warranty01_warranty_claim_idempotency.py"
    w6 = _read("w6payev01_payment_evidence.py")
    if not w5.is_file():
        # Standalone payment PR on main: parent is still w4
        assert 'down_revision' in w6 and "w4jtipurge01" in w6
        assert "PRE-MERGE" in w6
        return
    # Integrated tree: must be linear w4 → w5 → w6
    assert 'down_revision: Union[str, Sequence[str], None] = "w5warranty01"' in w6 or (
        '= "w5warranty01"' in w6
    ), "w6payev01 must revise w5warranty01 when warranty migration is present"


def test_pre_merge_note_when_on_w4():
    w6 = _read("w6payev01_payment_evidence.py")
    if '= "w4jtipurge01"' in w6:
        assert "PRE-MERGE" in w6
