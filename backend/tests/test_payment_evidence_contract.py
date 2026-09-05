from pathlib import Path

import pytest

from app.services.payment_evidence_service import PaymentEvidenceError, validate_evidence_bytes

ROOT = Path(__file__).resolve().parents[1]


def test_payment_evidence_magic_and_mime_validation():
    jpeg = b"\xff\xd8\xff" + b"x" * 32
    png = b"\x89PNG\r\n\x1a\n" + b"x" * 32
    pdf = b"%PDF-1.7\n" + b"x" * 32

    assert validate_evidence_bytes(jpeg, declared_content_type="image/jpeg").content_type == "image/jpeg"
    assert validate_evidence_bytes(png, declared_content_type="image/png").content_type == "image/png"
    assert validate_evidence_bytes(pdf, declared_content_type="application/pdf").content_type == "application/pdf"

    with pytest.raises(PaymentEvidenceError, match="evidence_mime_mismatch"):
        validate_evidence_bytes(pdf, declared_content_type="image/jpeg")
    with pytest.raises(PaymentEvidenceError, match="unsupported_evidence_magic"):
        validate_evidence_bytes(b"not-an-image-or-pdf", declared_content_type="image/jpeg")


def test_payment_evidence_review_reuses_canonical_finance_boundary():
    evidence_source = (ROOT / "app/services/payment_evidence_service.py").read_text()
    payment_source = (ROOT / "app/services/payment_service.py").read_text()

    assert "PaymentEvidence.status == \"submitted\"" in evidence_source
    assert "reviewed_evidence_id=evidence_id" in evidence_source
    assert "expense_from_payment" not in evidence_source
    assert "budget_spent" not in evidence_source
    assert "reviewed_evidence_id" in payment_source
    assert "await budget.expense_from_payment(db, payment)" in payment_source
    assert 'evidence_type, evidence_ref, source, note = (\n            "payment_evidence"' in payment_source


def test_payment_evidence_api_is_private_admin_reviewed_and_immutable_after_submit():
    api_source = (ROOT / "app/api/v1/payment_evidence.py").read_text()
    service_source = (ROOT / "app/services/payment_evidence_service.py").read_text()
    router_source = (ROOT / "app/api/v1/router.py").read_text()

    assert "require_admin_user" in api_source
    assert "payment-evidence" in api_source
    assert "storage_service.presigned_put" not in api_source
    assert '"external_presigned": False' in api_source
    assert "evidence_svc.lock_evidence" in api_source
    assert "await lock_evidence(db, evidence_id)" in service_source
    assert ".with_for_update()" in service_source
    assert "storage_service.presigned_url" in api_source
    assert "storage_service.read_bytes" in api_source
    assert "payment_evidence.router" in router_source
    assert "photos/" not in api_source


def test_payment_evidence_version_allocation_is_serialized_on_payment_truth():
    service_source = (ROOT / "app/services/payment_evidence_service.py").read_text()

    lock_marker = "select(Payment).where("
    version_marker = "version = int(latest or 0) + 1"
    replay_markers = service_source.count("scope=UPLOAD_INTENT_SCOPE")
    assert lock_marker in service_source
    assert version_marker in service_source
    assert service_source.index(lock_marker) < service_source.index(version_marker)
    assert replay_markers >= 2, "same-key requests must be rechecked after waiting on the parent-row lock"