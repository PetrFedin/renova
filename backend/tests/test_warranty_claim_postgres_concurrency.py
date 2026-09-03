"""Real PostgreSQL race proof for warranty claim creation."""
from __future__ import annotations
import asyncio, os
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
import app.models  # noqa: F401
from app.models.client_write_request import ClientWriteRequest
from app.models.entities import DomainOutbox, Project, ProjectIssue, User, UserRole
from app.models.project_documents import DocumentType, ProjectDocument
from app.services import outbox_service as outbox
from app.services import warranty_claim_service as warranty

def _postgres_url() -> str:
    value=os.environ.get("WARRANTY_CLAIM_POSTGRES_URL","").strip()
    if not value: pytest.skip("WARRANTY_CLAIM_POSTGRES_URL is only set by dedicated PostgreSQL workflow")
    return value
async def _no_inline(*_args,**_kwargs)->int:return 0
@pytest.mark.asyncio
async def test_concurrent_same_request_collapses_to_one_claim_and_effect_set(monkeypatch):
    monkeypatch.setattr(warranty.outbox_inline_dispatch,"dispatch_best_effort",_no_inline); engine=create_async_engine(_postgres_url()); Session=async_sessionmaker(engine,expire_on_commit=False)
    customer_id="warranty-race-customer"; contractor_id="warranty-race-contractor"; project_id="warranty-race-project"; request_id="warranty-race-request-0001"; title="Concurrent warranty claim"; description="Two replicas converge"
    try:
        async with Session() as db:
            db.add_all([User(id=customer_id,phone="+79663330001",role=UserRole.customer,full_name="Race customer"),User(id=contractor_id,phone="+79663330002",role=UserRole.contractor,full_name="Race contractor")]); await db.flush(); db.add(Project(id=project_id,name="Warranty race",renovation_type="cosmetic",customer_id=customer_id,contractor_id=contractor_id)); await db.commit()
        async def create_once():
            async with Session() as db:
                project=await db.get(Project,project_id); assert project is not None
                result=await warranty.create_or_replay_warranty_claim(db,project=project,user_id=customer_id,title=title,description=description,client_request_id=request_id); return result.issue_id,result.document_id
        first,second=await asyncio.gather(create_once(),create_once()); assert first==second; issue_id,document_id=first
        async with Session() as db:
            assert int(await db.scalar(select(func.count()).select_from(ProjectIssue).where(ProjectIssue.project_id==project_id,ProjectIssue.title==f"[Гарантия] {title}")) or 0)==1
            assert int(await db.scalar(select(func.count()).select_from(ProjectDocument).where(ProjectDocument.project_id==project_id,ProjectDocument.document_type==DocumentType.warranty.value,ProjectDocument.notes.contains(f"warranty_issue:{issue_id}"))) or 0)==1
            assert (await db.get(ProjectDocument,document_id)) is not None
            assert int(await db.scalar(select(func.count()).select_from(ClientWriteRequest).where(ClientWriteRequest.scope==warranty.WARRANTY_CLAIM_CREATE_SCOPE,ClientWriteRequest.project_id==project_id,ClientWriteRequest.user_id==customer_id,ClientWriteRequest.request_id==request_id)) or 0)==1
            assert int(await db.scalar(select(func.count()).select_from(DomainOutbox).where(DomainOutbox.aggregate_type=="warranty_claim",DomainOutbox.aggregate_id==issue_id,DomainOutbox.event_type.in_([outbox.ACTIVITY_EVENT,outbox.NOTIFICATION_EVENT]))) or 0)==2
    finally: await engine.dispose()
