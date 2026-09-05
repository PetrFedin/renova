"""Real PostgreSQL race proof for manual payment-evidence lifecycle."""
from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import Expense, Payment, PaymentEvent, PaymentStatus, PaymentType, Project, User, UserRole
from app.models.payment_evidence import PaymentEvidence
from app.services import payment_evidence_service as evidence_service


def _postgres_url() -> str:
    value = os.environ.get("PAYMENT_EVIDENCE_POSTGRES_URL", "").strip()
    if not value:
        pytest.skip("PAYMENT_EVIDENCE_POSTGRES_URL is only set by dedicated PostgreSQL workflow")
    return value


async def _seed(Session, suffix: str):
    customer_id = f"payment-evidence-customer-{suffix}"
    reviewer_id = f"payment-evidence-reviewer-{suffix}"
    project_id = f"payment-evidence-project-{suffix}"
    payment_id = f"payment-evidence-payment-{suffix}"
    evidence_id = f"payment-evidence-row-{suffix}"
    async with Session() as db:
        customer = User(
            id=customer_id,
            phone=f"+7966444{suffix[-4:]:0>4}1",
            role=UserRole.customer,
            full_name="Evidence customer",
        )
        reviewer = User(
            id=reviewer_id,
            phone=f"+7966555{suffix[-4:]:0>4}2",
            role=UserRole.contractor,
            full_name="Evidence reviewer",
        )
        db.add_all([customer, reviewer])
        await db.flush()
        db.add(
            Project(
                id=project_id,
                name="Payment evidence race",
                renovation_type="cosmetic",
                customer_id=customer_id,
                contractor_id=reviewer_id,
            )
        )
        await db.flush()
        db.add(
            Payment(
                id=payment_id,
                project_id=project_id,
                payment_type=PaymentType.advance,
                status=PaymentStatus.paid_unverified,
                title="Manual transfer",
                amount=12500.0,
                created_by=customer_id,
                payment_method="bank_transfer",
            )
        )
        db.add(
            PaymentEvidence(
                id=evidence_id,
                project_id=project_id,
                payment_id=payment_id,
                version=1,
                status="submitted",
                storage_key=f"payment-evidence/{project_id}/{payment_id}/{evidence_id}/v1.pdf",
                original_filename="proof.pdf",
                declared_content_type="application/pdf",
                verified_content_type="application/pdf",
                byte_size=32,
                sha256="a" * 64,
                submitted_by=customer_id,
            )
        )
        await db.commit()
    return customer_id, reviewer_id, project_id, payment_id, evidence_id


async def _seed_upload_intent(Session, suffix: str):
    customer_id = f"payment-evidence-upload-customer-{suffix}"
    project_id = f"payment-evidence-upload-project-{suffix}"
    payment_id = f"payment-evidence-upload-payment-{suffix}"
    async with Session() as db:
        customer = User(
            id=customer_id,
            phone=f"+7966777{suffix[-4:]:0>4}1",
            role=UserRole.customer,
            full_name="Evidence upload customer",
        )
        db.add(customer)
        await db.flush()
        db.add(
            Project(
                id=project_id,
                name="Payment evidence upload race",
                renovation_type="cosmetic",
                customer_id=customer_id,
            )
        )
        await db.flush()
        db.add(
            Payment(
                id=payment_id,
                project_id=project_id,
                payment_type=PaymentType.advance,
                status=PaymentStatus.pending,
                title="Manual transfer upload",
                amount=9300.0,
                created_by=customer_id,
            )
        )
        await db.commit()
    return customer_id, project_id, payment_id


@pytest.mark.asyncio
async def test_concurrent_same_key_upload_intent_replays_one_version():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id, project_id, payment_id = await _seed_upload_intent(Session, "1101")
    request_id = "payment-evidence-upload-same-1101"

    async def create_once():
        async with Session() as db:
            customer = await db.get(User, customer_id)
            assert customer is not None
            row, replayed = await evidence_service.prepare_upload_intent(
                db,
                project_id=project_id,
                payment_id=payment_id,
                user=customer,
                client_request_id=request_id,
                original_filename="proof.pdf",
                content_type="application/pdf",
            )
            return row.id, row.version, replayed

    try:
        first, second = await asyncio.gather(create_once(), create_once())
        assert first[0] == second[0]
        assert first[1] == second[1] == 1
        assert sorted([first[2], second[2]]) == [False, True]
        async with Session() as db:
            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(PaymentEvidence)
                    .where(PaymentEvidence.payment_id == payment_id)
                )
                or 0
            ) == 1
            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(ClientWriteRequest)
                    .where(
                        ClientWriteRequest.scope == evidence_service.UPLOAD_INTENT_SCOPE,
                        ClientWriteRequest.project_id == project_id,
                        ClientWriteRequest.user_id == customer_id,
                        ClientWriteRequest.request_id == request_id,
                    )
                )
                or 0
            ) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_independent_upload_intents_have_one_authoritative_winner():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    customer_id, project_id, payment_id = await _seed_upload_intent(Session, "1102")

    async def create_once(request_id: str):
        async with Session() as db:
            customer = await db.get(User, customer_id)
            assert customer is not None
            try:
                row, replayed = await evidence_service.prepare_upload_intent(
                    db,
                    project_id=project_id,
                    payment_id=payment_id,
                    user=customer,
                    client_request_id=request_id,
                    original_filename="proof.pdf",
                    content_type="application/pdf",
                )
                return row.id, replayed, None
            except evidence_service.PaymentEvidenceError as exc:
                return None, False, str(exc)

    try:
        results = await asyncio.gather(
            create_once("payment-evidence-upload-a-1102"),
            create_once("payment-evidence-upload-b-1102"),
        )
        successes = [item for item in results if item[2] is None]
        failures = [item for item in results if item[2] is not None]
        assert len(successes) == 1
        assert len(failures) == 1
        assert failures[0][2] == "active_evidence_exists"
        async with Session() as db:
            rows = list(
                (
                    await db.execute(
                        select(PaymentEvidence).where(PaymentEvidence.payment_id == payment_id)
                    )
                ).scalars().all()
            )
            assert len(rows) == 1
            assert rows[0].version == 1
            assert rows[0].status == "upload_pending"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_duplicate_approve_replays_and_recognizes_finance_once():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    _, reviewer_id, project_id, payment_id, evidence_id = await _seed(Session, "1001")
    request_id = "payment-evidence-review-same-1001"

    async def approve_once():
        async with Session() as db:
            reviewer = await db.get(User, reviewer_id)
            assert reviewer is not None
            row, replayed = await evidence_service.review_evidence(
                db,
                project_id=project_id,
                payment_id=payment_id,
                evidence_id=evidence_id,
                reviewer=reviewer,
                decision="approve",
                reason=None,
                client_request_id=request_id,
            )
            return row.id, replayed

    try:
        first, second = await asyncio.gather(approve_once(), approve_once())
        assert first[0] == second[0] == evidence_id
        assert sorted([first[1], second[1]]) == [False, True]
        async with Session() as db:
            payment = await db.get(Payment, payment_id)
            evidence = await db.get(PaymentEvidence, evidence_id)
            assert payment is not None and payment.status == PaymentStatus.confirmed
            assert evidence is not None and evidence.status == "approved"
            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(ClientWriteRequest)
                    .where(
                        ClientWriteRequest.scope == evidence_service.REVIEW_SCOPE,
                        ClientWriteRequest.project_id == project_id,
                        ClientWriteRequest.user_id == reviewer_id,
                        ClientWriteRequest.request_id == request_id,
                    )
                )
                or 0
            ) == 1
            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(PaymentEvent)
                    .where(
                        PaymentEvent.payment_id == payment_id,
                        PaymentEvent.evidence_type == "payment_evidence",
                        PaymentEvent.evidence_ref == evidence_id,
                        PaymentEvent.new_status == PaymentStatus.confirmed.value,
                    )
                )
                or 0
            ) == 1
            assert int(
                await db.scalar(
                    select(func.count())
                    .select_from(Expense)
                    .where(
                        Expense.project_id == project_id,
                        Expense.payment_id == payment_id,
                    )
                )
                or 0
            ) == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_concurrent_approve_reject_has_exactly_one_terminal_review_winner():
    engine = create_async_engine(_postgres_url())
    Session = async_sessionmaker(engine, expire_on_commit=False)
    _, reviewer_id, project_id, payment_id, evidence_id = await _seed(Session, "1002")

    async def decide(decision: str, request_id: str):
        async with Session() as db:
            reviewer = await db.get(User, reviewer_id)
            assert reviewer is not None
            try:
                row, replayed = await evidence_service.review_evidence(
                    db,
                    project_id=project_id,
                    payment_id=payment_id,
                    evidence_id=evidence_id,
                    reviewer=reviewer,
                    decision=decision,
                    reason="Unreadable transfer proof" if decision == "reject" else None,
                    client_request_id=request_id,
                )
                return decision, row.status, replayed, None
            except evidence_service.PaymentEvidenceError as exc:
                return decision, None, False, str(exc)

    try:
        results = await asyncio.gather(
            decide("approve", "payment-evidence-approve-1002"),
            decide("reject", "payment-evidence-reject-1002"),
        )
        successes = [item for item in results if item[3] is None]
        failures = [item for item in results if item[3] is not None]
        assert len(successes) == 1
        assert len(failures) == 1
        assert failures[0][3] == "evidence_already_reviewed"
        async with Session() as db:
            evidence = await db.get(PaymentEvidence, evidence_id)
            payment = await db.get(Payment, payment_id)
            assert evidence is not None and evidence.status in {"approved", "rejected"}
            assert payment is not None
            finance_events = int(
                await db.scalar(
                    select(func.count())
                    .select_from(PaymentEvent)
                    .where(
                        PaymentEvent.payment_id == payment_id,
                        PaymentEvent.evidence_type == "payment_evidence",
                        PaymentEvent.new_status == PaymentStatus.confirmed.value,
                    )
                )
                or 0
            )
            expenses = int(
                await db.scalar(
                    select(func.count())
                    .select_from(Expense)
                    .where(
                        Expense.project_id == project_id,
                        Expense.payment_id == payment_id,
                    )
                )
                or 0
            )
            if evidence.status == "approved":
                assert payment.status == PaymentStatus.confirmed
                assert finance_events == expenses == 1
            else:
                assert payment.status == PaymentStatus.paid_unverified
                assert finance_events == expenses == 0
    finally:
        await engine.dispose()