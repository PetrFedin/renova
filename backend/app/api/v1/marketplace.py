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
    JobLeadQuote,
    JobLeadStatus,
    LeadMessage,
    User,
    UserRole,
)
import re

router = APIRouter(tags=["marketplace"])


class ProfileIn(BaseModel):
    company_name: str | None = None
    specialties: str | None = None
    city: str | None = None
    bio: str | None = None
    payment_requisites: str | None = None


class LeadIn(BaseModel):
    """W140: заявка заказчика — реальный ввод, не демо-payload."""
    title: str = Field(min_length=1, max_length=255)
    address: str | None = None
    area_sqm: float = Field(gt=0, description="Площадь м²")
    renovation_type: str = "cosmetic"
    budget_hint: float = Field(gt=0, description="Ориентир бюджета ₽")
    description: str | None = Field(default=None, max_length=4000)


class QuoteIn(BaseModel):
    pre_estimate: float = Field(gt=0)


class ConvertLeadIn(BaseModel):
    property_type: str = "apartment"
    rooms: list | None = None


class LeadMsgIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


def _location_public(address: str | None) -> str | None:
    """City/district only — full street hidden until contractor assigned (P2.17)."""
    if not address:
        return None
    parts = [p.strip() for p in re.split(r"[,\n]", address) if p.strip()]
    if not parts:
        return None
    return ", ".join(parts[:2])


def _can_see_full_address(lead: JobLead, user: User) -> bool:
    return user.id == lead.customer_id or (
        lead.assigned_contractor_id is not None and user.id == lead.assigned_contractor_id
    )


def _lead_dict(lead: JobLead, viewer: User, quotes: list[JobLeadQuote] | None = None) -> dict:
    pub = _location_public(lead.address)
    full = _can_see_full_address(lead, viewer)
    out = {
        "id": lead.id,
        "title": lead.title,
        "address": lead.address if full else pub,
        "location_public": pub,
        "address_precision": "full" if full else "public",
        "area_sqm": lead.area_sqm,
        "renovation_type": lead.renovation_type,
        "budget_hint": lead.budget_hint,
        "description": lead.description,
        "status": lead.status.value,
        "pre_estimate": lead.pre_estimate,
        "assigned_contractor_id": lead.assigned_contractor_id,
        "quotes_count": len(quotes) if quotes is not None else 0,
    }
    if quotes is not None and (viewer.id == lead.customer_id or viewer.role == UserRole.customer):
        out["quotes"] = [
            {
                "id": q.id,
                "contractor_id": q.contractor_id,
                "pre_estimate": q.pre_estimate,
                "note": q.note,
                "created_at": q.created_at.isoformat() if q.created_at else None,
            }
            for q in quotes
        ]
    elif quotes is not None and viewer.role == UserRole.contractor:
        mine = [q for q in quotes if q.contractor_id == viewer.id]
        out["quotes"] = [
            {
                "id": q.id,
                "contractor_id": q.contractor_id,
                "pre_estimate": q.pre_estimate,
                "note": q.note,
                "created_at": q.created_at.isoformat() if q.created_at else None,
            }
            for q in mine
        ]
    return out


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




@router.get("/contractors/me/profile")
async def get_my_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Профиль исполнителя (в т.ч. payment_requisites для переводов)."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, "Только для исполнителя")
    profile = (
        await db.execute(select(ContractorProfile).where(ContractorProfile.user_id == user.id))
    ).scalar_one_or_none()
    if not profile:
        return {
            "user_id": user.id,
            "company_name": None,
            "specialties": None,
            "city": None,
            "bio": None,
            "payment_requisites": None,
            "full_name": user.full_name,
            "phone": user.phone,
        }
    return {
        "user_id": user.id,
        "company_name": profile.company_name,
        "specialties": profile.specialties,
        "city": profile.city,
        "bio": profile.bio,
        "payment_requisites": profile.payment_requisites,
        "full_name": user.full_name,
        "phone": user.phone,
        "id": profile.id,
    }


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
    lead_ids = [lead.id for lead in rows]
    quotes_by: dict[str, list[JobLeadQuote]] = {lid: [] for lid in lead_ids}
    if lead_ids:
        qrows = list(
            (await db.execute(select(JobLeadQuote).where(JobLeadQuote.lead_id.in_(lead_ids)))).scalars().all()
        )
        for qq in qrows:
            quotes_by.setdefault(qq.lead_id, []).append(qq)
    return [_lead_dict(lead, user, quotes_by.get(lead.id, [])) for lead in rows]


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
    """Add/update contractor quote without auto-assign (P2.18 — customer picks)."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, "contractor_only")
    lead = await db.get(JobLead, lead_id)
    if not lead or lead.status not in {JobLeadStatus.open, JobLeadStatus.quoted}:
        raise HTTPException(404, "lead_not_open")
    if lead.assigned_contractor_id and lead.assigned_contractor_id != user.id:
        raise HTTPException(409, "lead_already_assigned")
    existing = (
        await db.execute(
            select(JobLeadQuote).where(
                JobLeadQuote.lead_id == lead_id,
                JobLeadQuote.contractor_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.pre_estimate = body.pre_estimate
        quote = existing
    else:
        quote = JobLeadQuote(
            lead_id=lead_id,
            contractor_id=user.id,
            pre_estimate=body.pre_estimate,
        )
        db.add(quote)
    # Keep lead open until customer accepts a quote; mirror latest for board display
    lead.pre_estimate = body.pre_estimate
    if lead.status == JobLeadStatus.open:
        pass  # stay open — multiple quotes allowed
    await db.commit()
    await db.refresh(quote)
    return {"ok": True, "quote_id": quote.id, "pre_estimate": quote.pre_estimate, "awaiting_customer_pick": True}


@router.post("/job-leads/{lead_id}/quotes/{quote_id}/accept")
async def accept_quote(
    lead_id: str,
    quote_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Customer selects one contractor quote → assign + quoted status."""
    if user.role != UserRole.customer:
        raise HTTPException(403, "customer_only")
    lead = await db.get(JobLead, lead_id)
    if not lead or lead.customer_id != user.id:
        raise HTTPException(404, "lead_not_found")
    if lead.assigned_contractor_id:
        raise HTTPException(409, "lead_already_assigned")
    quote = await db.get(JobLeadQuote, quote_id)
    if not quote or quote.lead_id != lead_id:
        raise HTTPException(404, "quote_not_found")
    lead.assigned_contractor_id = quote.contractor_id
    lead.pre_estimate = quote.pre_estimate
    lead.status = JobLeadStatus.quoted
    await db.commit()
    return {
        "ok": True,
        "assigned_contractor_id": lead.assigned_contractor_id,
        "pre_estimate": lead.pre_estimate,
        "status": lead.status.value,
    }


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
