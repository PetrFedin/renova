from pathlib import Path
import uuid

import pytest
from sqlalchemy import func, select

from app.models.entities import Expense, Payment, PaymentStatus, PaymentType, Project, User, UserRole
from app.services import payment_evidence_service as evidence_service
from app.services.client_write_idempotency import IdempotencyConflict
from app.services.payment_evidence_service import PaymentEvidenceError, validate_evidence_bytes

ROOT = Path(__file__).resolve().parents[1]


def _id() -> str:
    return str(uuid.uuid4())


async def _seed_payment(db, *, status: PaymentStatus = PaymentStatus.pending):
    customer = User(
        id=_id(),
        phone=f"+79{uuid.uuid4().int % 10**9:09d}",
        role=UserRole.customer,
        full_name="Evidence customer",
    )
    outsider = User(
        id=_id(),
        phone=f"+78{uuid.uuid4().int % 10**9:09d}",
        role=UserRole.customer,
        full_name="Other customer",
    )
    reviewer = User(
        id=_id(),
        phone=f"+77{uuid.uuid4().int % 10**9:09d}",
        role=UserRole.contractor,
        full_name="Evidence reviewer",
    )
    db.add_all([customer, outsider, reviewer])
    await db.flush()
    project = Project(
        id=_id(),
        name="Evidence project",
        renovation_type="cosmetic",
        customer_id=customer.id,
    )
    db.add(project)
    await db.flush()
    payment = Payment(
        id=_id(),
        project_id=project.id,
        payment_type=PaymentType.advance,
        status=status,
        title="Manual transfer",
        amount=12500.0,
        created_by=customer.id,
    )
    db.add(payment)
    await db.commit()
    return customer, outsider, reviewer, project, payment


def test_payment_evidence_magic_mime_and_size_validation():
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
    with pytest.raises(PaymentEvidenceError, match="evidence_too_large"):
        validate_evidence_bytes(
            b"%PDF-" + b"x" * evidence_service.MAX_EVIDENCE_BYTES,
            declared_content_type="application/pdf",
        )


@pytest.mark.asyncio
async def test_upload_intent_replay_conflict_acl_and_active_version(db):
    customer, outsider, _reviewer, project, payment = await _seed_payment(db)
    request_id = "payment-evidence-intent-focused-0001"

    first, replayed = await evidence_service.prepare_upload_intent(
        db,
        project_id=project.id,
        payment_id=payment.id,
        user=customer,
        client_request_id=request_id,
        original_filename="proof.pdf",
        content_type="application/pdf",
    )
    assert replayed is False
    assert first.version == 1
    assert first.status == "upload_pending"

    same, replayed = await evidence_service.prepare_upload_intent(
        db,
        project_id=project.id,
        payment_id=payment.id,
        user=customer,
        client_request_id=request_id,
        original_filename="proof.pdf",
        content_type="application/pdf",
    )
    assert replayed is True
    assert same.id == first.id

    with pytest.raises(IdempotencyConflict, match="idempotency_conflict"):
        await evidence_service.prepare_upload_intent(
            db,
            project_id=project.id,
            payment_id=payment.id,
            user=customer,
            client_request_id=request_id,
            original_filename="different.pdf",
            content_type="application/pdf",
        )

    with pytest.raises(PaymentEvidenceError, match="customer_required"):
        await evidence_service.prepare_upload_intent(
            db,
            project_id=project.id,
            payment_id=payment.id,
            user=outsider,
            client_request_id="payment-evidence-intent-focused-0002",
            original_filename="proof.pdf",
            content_type="application/pdf",
        )

    with pytest.raises(PaymentEvidenceError, match="project_not_found"):
        await evidence_service.prepare_upload_intent(
            db,
            project_id=_id(),
            payment_id=payment.id,
            user=customer,
            client_request_id="payment-evidence-intent-focused-0003",
            original_filename="proof.pdf",
            content_type="application/pdf",
        )

    with pytest.raises(PaymentEvidenceError, match="active_evidence_exists"):
        await evidence_service.prepare_upload_intent(
            db,
            project_id=project.id,
            payment_id=payment.id,
            user=customer,
            client_request_id="payment-evidence-intent-focused-0004",
            original_filename="second.pdf",
            content_type="application/pdf",
        )


@pytest.mark.asyncio
async def test_submit_is_replay_safe_and_keeps_paid_unverified_non_financial(db, monkeypatch):
    customer, _outsider, _reviewer, project, payment = await _seed_payment(db)
    evidence, _ = await evidence_service.prepare_upload_intent(
        db,
        project_id=project.id,
        payment_id=payment.id,
        user=customer,
        client_request_id="payment-evidence-intent-submit-0001",
        original_filename="proof.pdf",
        content_type="application/pdf",
    )

    async def read_bytes(_key: str):
        return b"%PDF-1.7\n" + b"x" * 64

    monkeypatch.setattr(evidence_service.storage_service, "read_bytes", read_bytes)
    request_id = "payment-evidence-submit-focused-0001"
    submitted, replayed = await evidence_service.submit_uploaded_evidence(
        db,
        project_id=project.id,
        payment_id=payment.id,
        evidence_id=evidence.id,
        user=customer,
        client_request_id=request_id,
    )
    assert replayed is False
    assert submitted.status == "submitted"
    assert submitted.sha256

    current_payment = await db.get(Payment, payment.id)
    assert current_payment is not None
    assert current_payment.status == PaymentStatus.paid_unverified
    assert int(
        await db.scalar(
            select(func.count())
            .select_from(Expense)
            .where(Expense.payment_id == payment.id)
        )
        or 0
    ) == 0

    same, replayed = await evidence_service.submit_uploaded_evidence(
        db,
        project_id=project.id,
        payment_id=payment.id,
        evidence_id=evidence.id,
        user=customer,
        client_request_id=request_id,
    )
    assert replayed is True
    assert same.id == evidence.id
    assert same.status == "submitted"


@pytest.mark.asyncio
async def test_reject_requires_reason_preserves_non_financial_truth_and_allows_v2(db, monkeypatch):
    customer, _outsider, reviewer, project, payment = await _seed_payment(db)
    evidence, _ = await evidence_service.prepare_upload_intent(
        db,
        project_id=project.id,
        payment_id=payment.id,
        user=customer,
        client_request_id="payment-evidence-intent-reject-0001",
        original_filename="proof.pdf",
        content_type="application/pdf",
    )

    async def read_bytes(_key: str):
        return b"%PDF-1.7\n" + b"x" * 64

    monkeypatch.setattr(evidence_service.storage_service, "read_bytes", read_bytes)
    submitted, _ = await evidence_service.submit_uploaded_evidence(
        db,
        project_id=project.id,
        payment_id=payment.id,
        evidence_id=evidence.id,
        user=customer,
        client_request_id="payment-evidence-submit-reject-0001",
    )
    assert submitted.status == "submitted"

    with pytest.raises(PaymentEvidenceError, match="rejection_reason_required"):
        await evidence_service.review_evidence(
            db,
            project_id=project.id,
            payment_id=payment.id,
            evidence_id=evidence.id,
            reviewer=reviewer,
            decision="reject",
            reason="   ",
            client_request_id="payment-evidence-review-reject-empty-0001",
        )

    rejected, replayed = await evidence_service.review_evidence(
        db,
        project_id=project.id,
        payment_id=payment.id,
        evidence_id=evidence.id,
        reviewer=reviewer,
        decision="reject",
        reason="Файл нечитаем",
        client_request_id="payment-evidence-review-reject-0001",
    )
    assert replayed is False
    assert rejected.status == "rejected"
    assert rejected.rejection_reason == "Файл нечитаем"
    current_payment = await db.get(Payment, payment.id)
    assert current_payment is not None
    assert current_payment.status == PaymentStatus.paid_unverified

    replacement, replayed = await evidence_service.prepare_upload_intent(
        db,
        project_id=project.id,
        payment_id=payment.id,
        user=customer,
        client_request_id="payment-evidence-intent-reject-0002",
        original_filename="proof-v2.pdf",
        content_type="application/pdf",
    )
    assert replayed is False
    assert replacement.version == 2
    assert replacement.id != evidence.id


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", [PaymentStatus.disputed, PaymentStatus.refunded, PaymentStatus.cancelled])
async def test_terminal_payment_blocks_new_evidence_intent(db, terminal):
    customer, _outsider, _reviewer, project, payment = await _seed_payment(db, status=terminal)

    with pytest.raises(PaymentEvidenceError, match="payment_terminal"):
        await evidence_service.prepare_upload_intent(
            db,
            project_id=project.id,
            payment_id=payment.id,
            user=customer,
            client_request_id=f"payment-evidence-terminal-{terminal.value}-0001",
            original_filename="proof.pdf",
            content_type="application/pdf",
        )


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


def test_payment_evidence_read_acl_excludes_generic_project_viewers_and_team_members():
    api_source = (ROOT / "app/api/v1/payment_evidence.py").read_text()

    assert 'project.customer_id != user.id' in api_source
    assert 'payment_evidence_read_forbidden' in api_source
    assert 'admin_access_state(user)' in api_source
    assert 'require_project(db, project_id, user, write=False)' not in api_source


def test_payment_evidence_version_allocation_is_serialized_on_payment_truth():
    service_source = (ROOT / "app/services/payment_evidence_service.py").read_text()

    lock_marker = "select(Payment).where("
    version_marker = "version = int(latest or 0) + 1"
    replay_markers = service_source.count("scope=UPLOAD_INTENT_SCOPE")
    assert lock_marker in service_source
    assert version_marker in service_source
    assert service_source.index(lock_marker) < service_source.index(version_marker)
    assert replay_markers >= 2, "same-key requests must be rechecked after waiting on the parent-row lock"