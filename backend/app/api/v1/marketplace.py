from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import LeadMessage,  User, UserRole, ContractorProfile, ContractorPortfolioPhoto, JobLead, JobLeadStatus

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
    pre_estimate: float

@router.get("/contractors")
async def list_contractors(city: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = select(ContractorProfile, User).join(User, User.id == ContractorProfile.user_id).where(ContractorProfile.visible == True)
    if city: q = q.where(ContractorProfile.city == city)
    r = await db.execute(q)
    return [{"id": p.id, "user_id": p.user_id, "name": u.full_name or u.phone, "company": p.company_name, "specialties": p.specialties, "rating": p.rating, "jobs_done": p.jobs_done, "city": p.city, "bio": p.bio} for p, u in r.all()]

@router.post("/contractors/profile")
async def upsert_profile(body: ProfileIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor: raise HTTPException(403)
    r = await db.execute(select(ContractorProfile).where(ContractorProfile.user_id == user.id))
    p = r.scalar_one_or_none()
    if not p:
        p = ContractorProfile(user_id=user.id, **body.model_dump()); db.add(p)
    else:
        for k, v in body.model_dump().items(): setattr(p, k, v)
    await db.commit(); await db.refresh(p)
    return {"ok": True, "id": p.id}

@router.get("/job-leads")
async def list_leads(status: str | None = "open", user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = select(JobLead).order_by(JobLead.created_at.desc())
    if status: q = q.where(JobLead.status == JobLeadStatus(status))
    r = await db.execute(q.limit(50))
    return [{"id": l.id, "title": l.title, "address": l.address, "area_sqm": l.area_sqm, "renovation_type": l.renovation_type, "budget_hint": l.budget_hint, "description": l.description, "status": l.status.value, "pre_estimate": l.pre_estimate} for l in r.scalars().all()]

@router.post("/job-leads")
async def create_lead(body: LeadIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.customer: raise HTTPException(403)
    l = JobLead(customer_id=user.id, **body.model_dump())
    db.add(l); await db.commit(); await db.refresh(l)
    return {"id": l.id, "status": l.status.value}

@router.post("/job-leads/{lead_id}/quote")
async def quote_lead(lead_id: str, body: QuoteIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor: raise HTTPException(403)
    l = await db.get(JobLead, lead_id)
    if not l or l.status != JobLeadStatus.open: raise HTTPException(404)
    l.pre_estimate = body.pre_estimate; l.status = JobLeadStatus.quoted; l.assigned_contractor_id = user.id
    await db.commit()
    return {"ok": True, "pre_estimate": l.pre_estimate}

@router.get("/contractors/match")
async def match_contractors(renovation_type: str | None = None, specialty: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = select(ContractorProfile, User).join(User, User.id == ContractorProfile.user_id).where(ContractorProfile.visible == True)
    r = await db.execute(q)
    out = []
    for p, u in r.all():
        score = p.rating
        if specialty and p.specialties and specialty in (p.specialties or ""): score += 2
        if renovation_type and renovation_type in (p.specialties or ""): score += 1
        out.append({"id": p.id, "user_id": p.user_id, "name": u.full_name or u.phone, "company": p.company_name, "specialties": p.specialties, "rating": p.rating, "score": round(score, 1), "city": p.city})
    out.sort(key=lambda x: x["score"], reverse=True)
    return out[:10]

@router.get("/contractors/{profile_id}/portfolio")
async def portfolio(profile_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(ContractorPortfolioPhoto).where(ContractorPortfolioPhoto.profile_id == profile_id))
    return [{"id": x.id, "image_key": x.image_key, "image_url": f"/api/v1/media/{x.image_key}", "caption": x.caption} for x in r.scalars().all()]

@router.post("/contractors/{profile_id}/portfolio")
async def add_portfolio(profile_id: str, image_key: str, caption: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor: raise HTTPException(403)
    p = ContractorPortfolioPhoto(profile_id=profile_id, image_key=image_key, caption=caption)
    db.add(p); await db.commit()
    return {"ok": True, "id": p.id}

class ConvertLeadIn(BaseModel):
    property_type: str = "apartment"
    rooms: list | None = None


@router.post("/job-leads/{lead_id}/convert")
async def convert_lead(lead_id: str, body: ConvertLeadIn | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import project_service as ps
    l = await db.get(JobLead, lead_id)
    if not l: raise HTTPException(404)
    if user.role == UserRole.contractor and l.assigned_contractor_id != user.id and l.status != JobLeadStatus.quoted:
        raise HTTPException(403)
    from app.schemas.project import RoomInput
    if body and body.rooms:
        rooms = [r if isinstance(r, dict) else r.model_dump() for r in body.rooms]
    else:
        rooms = [{"name": "Комната", "length_m": 4, "width_m": 3, "height_m": 2.7, "room_type": "living", "floor_level": 1}]
    prop = body.property_type if body else "apartment"
    proj = await ps.create_project(db, customer_id=l.customer_id, name=l.title, address=l.address, renovation_type=l.renovation_type, rooms_data=rooms, contractor_id=user.id if user.role == UserRole.contractor else l.assigned_contractor_id, total_area_sqm=l.area_sqm, property_type=prop)
    l.status = JobLeadStatus.taken
    await db.commit()
    return {"project_id": proj.id, "name": proj.name}

class LeadMsgIn(BaseModel):
    text: str

@router.get("/job-leads/{lead_id}/messages")
async def lead_messages(lead_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(LeadMessage).where(LeadMessage.lead_id == lead_id).order_by(LeadMessage.created_at))
    return [{"id": m.id, "user_id": m.user_id, "text": m.text, "at": m.created_at.isoformat()} for m in r.scalars().all()]

@router.post("/job-leads/{lead_id}/messages")
async def post_lead_msg(lead_id: str, body: LeadMsgIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    m = LeadMessage(lead_id=lead_id, user_id=user.id, text=body.text.strip())
    db.add(m); await db.commit()
    return {"ok": True, "id": m.id}

@router.post("/job-leads/{lead_id}/auto-assign")
async def auto_assign(lead_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.customer: raise HTTPException(403)
    l = await db.get(JobLead, lead_id)
    if not l: raise HTTPException(404)
    r = await db.execute(select(ContractorProfile, User).join(User, User.id == ContractorProfile.user_id).where(ContractorProfile.visible == True))
    best = None; score = -1
    for p, u in r.all():
        sc = p.rating + (2 if l.renovation_type in (p.specialties or "") else 0)
        if sc > score: score = sc; best = u
    if not best: raise HTTPException(404, "Нет исполнителей")
    l.assigned_contractor_id = best.id; l.status = JobLeadStatus.quoted
    await db.commit()
    return {"contractor_id": best.id, "name": best.full_name or best.phone}
