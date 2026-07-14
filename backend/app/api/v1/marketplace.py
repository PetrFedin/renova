from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import (
    ContractorPortfolioPhoto,
    ContractorProfile,
    JobLead,
    JobLeadStatus,
    LeadMessage,
    User,
    UserRole,
)

router = APIRouter(tags=["marketplace"])


class ProfileIn(BaseModel):
    company_name: str | None = None
    specialties: str | None = None
    city: str | None = None
    bio: str | None = None


class LeadIn(BaseModel):
    title: str
    address: str | None = None
    area_sqm: float | None = None
    renovation_type: str = "cosmetic"
    budget_hint: float | None = None
    description: str | None = None


class QuoteIn(BaseModel):
    pre_estimate: float = Field(gt=0)


class ConvertLeadIn(BaseModel):
    property_type: str = "apartment"
    rooms: list | None = None


class LeadMsgIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


def _lead_dict(lead: JobLead) -> dict:
    return {
        "id": lead.id,
        "title": lead.title,
        "address": lead.address,
        "area_sqm": lead.area_sqm,
        "renovation_type": lead.renovation_type,
        "budget_hint": lead.budget_hint,
        "description": lead.description,
        "status": lead.status.value,
        "pre_estimate": lead.pre_estimate,
    }


def _can_access_lead(lead: JobLead, user: User) -> bool:
    if user.role == UserRole.customer:
        return lead.customer_id == user.id
    return lead.assigned_contractor_id == user.id or lead.status == JobLeadStatus.open


def _can_message_lead(lead: JobLead, user: User) -> bool:
    if user.role == UserRole.customer:
        return lead.customer_id == user.id
    return lead.assigned_contractor_id == user.id


@router.get("/contractors")
async def list_contractors(
    city: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(ContractorProfile, User)
        .join(User, User.id == ContractorProfile.user_id)
        .where(ContractorProfile.visible.is_(True))
    )
    if city:
        q = q.where(ContractorProfile.city == city)
    rows = (await db.execute(q)).all()
    return [
        {
            "id": profile.id,
            "user_id": profile.user_id,
            "name": contractor.full_name or contractor.phone,
            "company": profile.company_name,
            "specialties": profile.specialties,
            "rating": profile.rating,
            "jobs_done": profile.jobs_done,
            "city": profile.city,
            "bio": profile.bio,
        }
        for profile, contractor in rows
    ]


@router.post("/contractors/profile")
async def upsert_profile(
    body: ProfileIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "contractor_only")
    profile = (
        await db.execute(select(ContractorProfile).where(ContractorProfile.user_id == user.id))
    ).scalar_one_or_none()
    if not profile:
        profile = ContractorProfile(user_id=user.id, **body.model_dump())
        db.add(profile)
    else:
        for key, value in body.model_dump().items():
            setattr(profile, key, value)
    await db.commit()
    await db.refresh(profile)
    return {"ok": True, "id": profile.id}


@router.get("/job-leads")
async def list_leads(
    status: str | None = "open",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(JobLead).order_by(JobLead.created_at.desc())
    if user.role == UserRole.customer:
        q = q.where(JobLead.customer_id == user.id)
    else:
        q = q.where(
            or_(
                JobLead.status == JobLeadStatus.open,
                JobLead.assigned_contractor_id == user.id,
            )
        )
    if status:
        try:
            q = q.where(JobLead.status == JobLeadStatus(status))
        except ValueError as exc:
            raise HTTPException(422, "invalid_lead_status") from exc
    rows = list((await db.execute(q.limit(50))).scalars().all())
    return [_lead_dict(lead) for lead in rows]


@router.post("/job-leads")
async def create_lead(
    body: LeadIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.customer:
        raise HTTPException(403, "customer_only")
    lead = JobLead(customer_id=user.id, **body.model_dump())
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    return {"id": lead.id, "status": lead.status.value}


@router.post("/job-leads/{lead_id}/quote")
async def quote_lead(
    lead_id: str,
    body: QuoteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "contractor_only")
    lead = await db.get(JobLead, lead_id)
    if not lead or lead.status != JobLeadStatus.open:
        raise HTTPException(404, "lead_not_open")
    lead.pre_estimate = body.pre_estimate
    lead.status = JobLeadStatus.quoted
    lead.assigned_contractor_id = user.id
    await db.commit()
    return {"ok": True, "pre_estimate": lead.pre_estimate}


@router.get("/contractors/match")
async def match_contractors(
    renovation_type: str | None = None,
    specialty: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(ContractorProfile, User)
        .join(User, User.id == ContractorProfile.user_id)
        .where(ContractorProfile.visible.is_(True))
    )
    rows = (await db.execute(q)).all()
    result = []
    for profile, contractor in rows:
        score = profile.rating
        if specialty and profile.specialties and specialty in profile.specialties:
            score += 2
        if renovation_type and renovation_type in (profile.specialties or ""):
            score += 1
        result.append({
            "id": profile.id,
            "user_id": profile.user_id,
            "name": contractor.full_name or contractor.phone,
            "company": profile.company_name,
            "specialties": profile.specialties,
            "rating": profile.rating,
            "score": round(score, 1),
            "city": profile.city,
        })
    result.sort(key=lambda item: item["score"], reverse=True)
    return result[:10]


@router.get("/contractors/{profile_id}/portfolio")
async def portfolio(
    profile_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(ContractorPortfolioPhoto).where(ContractorPortfolioPhoto.profile_id == profile_id)
        )
    ).scalars().all()
    return [
        {
            "id": item.id,
            "image_key": item.image_key,
            "image_url": f"/api/v1/media/{item.image_key}",
            "caption": item.caption,
        }
        for item in rows
    ]


@router.post("/contractors/{profile_id}/portfolio")
async def add_portfolio(
    profile_id: str,
    image_key: str,
    caption: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "contractor_only")
    profile = await db.get(ContractorProfile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(404, "contractor_profile_not_found")
    photo = ContractorPortfolioPhoto(profile_id=profile_id, image_key=image_key, caption=caption)
    db.add(photo)
    await db.commit()
    await db.refresh(photo)
    return {"ok": True, "id": photo.id}


@router.post("/job-leads/{lead_id}/convert")
async def convert_lead(
    lead_id: str,
    body: ConvertLeadIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services import project_service as project_service

    lead = await db.get(JobLead, lead_id)
    if not lead:
        raise HTTPException(404, "lead_not_found")
    if lead.status != JobLeadStatus.quoted:
        raise HTTPException(409, "lead_not_ready_for_conversion")

    if user.role == UserRole.customer:
        if lead.customer_id != user.id:
            raise HTTPException(403, "lead_owner_only")
        contractor_id = lead.assigned_contractor_id
    else:
        if lead.assigned_contractor_id != user.id:
            raise HTTPException(403, "assigned_contractor_only")
        contractor_id = user.id

    if not contractor_id:
        raise HTTPException(409, "lead_has_no_contractor")

    if body and body.rooms:
        rooms = [room if isinstance(room, dict) else room.model_dump() for room in body.rooms]
    else:
        rooms = [{
            "name": "Комната",
            "length_m": 4,
            "width_m": 3,
            "height_m": 2.7,
            "room_type": "living",
            "floor_level": 1,
        }]
    property_type = body.property_type if body else "apartment"
    project = await project_service.create_project(
        db,
        customer_id=lead.customer_id,
        name=lead.title,
        address=lead.address,
        renovation_type=lead.renovation_type,
        rooms_data=rooms,
        contractor_id=contractor_id,
        total_area_sqm=lead.area_sqm,
        property_type=property_type,
    )
    lead.status = JobLeadStatus.taken
    await db.commit()
    return {"project_id": project.id, "name": project.name}


@router.get("/job-leads/{lead_id}/messages")
async def lead_messages(
    lead_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(JobLead, lead_id)
    if not lead or not _can_message_lead(lead, user):
        raise HTTPException(404, "lead_not_found")
    rows = (
        await db.execute(
            select(LeadMessage)
            .where(LeadMessage.lead_id == lead_id)
            .order_by(LeadMessage.created_at)
        )
    ).scalars().all()
    return [
        {"id": message.id, "user_id": message.user_id, "text": message.text, "at": message.created_at.isoformat()}
        for message in rows
    ]


@router.post("/job-leads/{lead_id}/messages")
async def post_lead_msg(
    lead_id: str,
    body: LeadMsgIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(JobLead, lead_id)
    if not lead or not _can_message_lead(lead, user):
        raise HTTPException(404, "lead_not_found")
    message = LeadMessage(lead_id=lead_id, user_id=user.id, text=body.text.strip())
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return {"ok": True, "id": message.id}


@router.post("/job-leads/{lead_id}/auto-assign")
async def auto_assign(
    lead_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.customer:
        raise HTTPException(403, "customer_only")
    lead = await db.get(JobLead, lead_id)
    if not lead or lead.customer_id != user.id:
        raise HTTPException(404, "lead_not_found")
    if lead.status not in {JobLeadStatus.open, JobLeadStatus.quoted}:
        raise HTTPException(409, "lead_not_assignable")

    rows = (
        await db.execute(
            select(ContractorProfile, User)
            .join(User, User.id == ContractorProfile.user_id)
            .where(ContractorProfile.visible.is_(True))
        )
    ).all()
    best_user = None
    best_score = -1.0
    for profile, contractor in rows:
        score = profile.rating + (2 if lead.renovation_type in (profile.specialties or "") else 0)
        if score > best_score:
            best_score = score
            best_user = contractor
    if not best_user:
        raise HTTPException(404, "no_contractors")

    lead.assigned_contractor_id = best_user.id
    lead.status = JobLeadStatus.quoted
    await db.commit()
    return {"contractor_id": best_user.id, "name": best_user.full_name or best_user.phone}
