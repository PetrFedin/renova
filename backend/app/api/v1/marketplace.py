from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.services import contractor_reputation_service as reputation
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
import logging
import re

from app.core.timeutil import utc_now

from app.services import marketplace_notifications
from app.services.calc.estimate import RenovationType

router = APIRouter(tags=["marketplace"])

ANONYMOUS_CONTRACTOR_NAME = "Исполнитель"


class ProfileIn(BaseModel):
    """MKT-003: частичное сохранение профиля. Поле, которого нет в теле или равного null,
    не меняется (null не «стирает»); пустая строка — осознанная очистка."""
    company_name: str | None = Field(default=None, max_length=255)
    specialties: str | None = Field(default=None, max_length=512)
    city: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=4000)
    payment_requisites: str | None = Field(default=None, max_length=1000)


class LeadIn(BaseModel):
    """W140: заявка заказчика — реальный ввод, не демо-payload."""
    title: str = Field(min_length=1, max_length=255)
    address: str | None = None
    area_sqm: float = Field(gt=0, description="Площадь м²")
    renovation_type: RenovationType = "cosmetic"
    budget_hint: float = Field(gt=0, description="Ориентир бюджета ₽")
    description: str | None = Field(default=None, max_length=4000)


class LeadPatchIn(BaseModel):
    """MKT-005: правка заявки заказчиком, пока она open и отклик не принят."""
    title: str | None = Field(default=None, min_length=1, max_length=255)
    address: str | None = None
    area_sqm: float | None = Field(default=None, gt=0)
    renovation_type: RenovationType | None = None
    budget_hint: float | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, max_length=4000)


class LeadCloseIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class QuoteIn(BaseModel):
    pre_estimate: float = Field(gt=0)
    note: str | None = Field(default=None, max_length=2000)


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
    is_owner = viewer.id == lead.customer_id
    # Price ACL: a contractor's pre_estimate is visible only to the lead owner,
    # the assigned contractor and the quote's own author — never to competing
    # contractors (lead.pre_estimate may hold another contractor's price).
    if is_owner or (lead.assigned_contractor_id is not None and viewer.id == lead.assigned_contractor_id):
        visible_estimate = lead.pre_estimate
    else:
        own = [q for q in (quotes or []) if q.contractor_id == viewer.id]
        visible_estimate = own[0].pre_estimate if own else None
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
        "pre_estimate": visible_estimate,
        "assigned_contractor_id": lead.assigned_contractor_id,
        "quotes_count": len(quotes) if quotes is not None else 0,
        "has_my_quote": any(q.contractor_id == viewer.id for q in (quotes or [])),
    }
    # MKT-005: причину закрытия видят владелец и откликнувшиеся/назначенный исполнитель.
    if lead.status == JobLeadStatus.closed and (
        is_owner
        or lead.assigned_contractor_id == viewer.id
        or any(q.contractor_id == viewer.id for q in (quotes or []))
    ):
        out["closed_reason"] = lead.closed_reason
        out["closed_at"] = lead.closed_at.isoformat() if lead.closed_at else None
    if quotes is not None and is_owner:
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


def _public_name(contractor: User) -> str:
    """MKT-014: телефон исполнителя в публичных ответах не отдаём."""
    return (contractor.full_name or "").strip() or ANONYMOUS_CONTRACTOR_NAME


async def _resolve_lead_thread(
    db: AsyncSession, lead: JobLead, user: User, contractor_id: str | None
) -> str:
    """MKT-010: id исполнителя-собеседника (`thread_contractor_id`) или 404/422.

    Заказчик-владелец видит каждый тред отдельно (`contractor_id`; по умолчанию —
    назначенный исполнитель). Исполнитель — только свой тред, и только если оставил
    отклик либо назначен; чужие треды и посторонние получают 404.
    """
    if user.role == UserRole.customer:
        if lead.customer_id != user.id:
            raise HTTPException(404, "lead_not_found")
        tid = contractor_id or lead.assigned_contractor_id
        if not tid:
            raise HTTPException(422, detail={
                "code": "thread_contractor_required",
                "message": "Выберите исполнителя, с которым хотите переписываться.",
            })
        if tid != lead.assigned_contractor_id:
            quoted = (
                await db.execute(
                    select(JobLeadQuote.id).where(
                        JobLeadQuote.lead_id == lead.id, JobLeadQuote.contractor_id == tid
                    )
                )
            ).first()
            if not quoted:
                raise HTTPException(404, "thread_not_found")
        return tid
    if user.role != UserRole.contractor:
        raise HTTPException(404, "lead_not_found")
    if contractor_id and contractor_id != user.id:
        raise HTTPException(404, "lead_not_found")
    if lead.assigned_contractor_id:
        # после назначения чат остаётся только у назначенного (проигравшие — как раньше, 404)
        if lead.assigned_contractor_id != user.id:
            raise HTTPException(404, "lead_not_found")
        return user.id
    quoted = (
        await db.execute(
            select(JobLeadQuote.id).where(
                JobLeadQuote.lead_id == lead.id, JobLeadQuote.contractor_id == user.id
            )
        )
    ).first()
    if not quoted:
        raise HTTPException(404, "lead_not_found")
    return user.id


def _thread_filter(lead: JobLead, tid: str):
    """Сообщения треда; старые без thread_contractor_id — у назначенного исполнителя."""
    if lead.assigned_contractor_id == tid:
        return or_(
            LeadMessage.thread_contractor_id == tid,
            LeadMessage.thread_contractor_id.is_(None),
        )
    return LeadMessage.thread_contractor_id == tid


async def _safe_notify(db: AsyncSession, call) -> None:
    """Уведомление биржи не должно ронять уже зафиксированное действие (MKT-006)."""
    try:
        await call
    except Exception:  # noqa: BLE001 — бизнес-изменение уже закоммичено
        await db.rollback()
        logging.getLogger(__name__).exception("marketplace notification failed")


@router.get("/contractors")
async def list_contractors(
    city: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(ContractorProfile, User)
        .join(User, User.id == ContractorProfile.user_id)
        .where(ContractorProfile.visible.is_(True), User.deleted_at.is_(None))
    )
    if city:
        q = q.where(ContractorProfile.city == city)
    rows = (await db.execute(q)).all()
    return [
        {
            "id": profile.id,
            "profile_id": profile.id,
            "user_id": profile.user_id,
            "name": _public_name(contractor),
            "company": profile.company_name,
            "specialties": profile.specialties,
            # `rating`/`jobs_done` отдаются только когда их кто-то измерил;
            # значение по умолчанию — не измерение (см. reputation-сервис).
            "rating": reputation.public_rating(profile),
            "jobs_done": reputation.public_jobs_done(profile),
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
    # MKT-003: только присланные и не-null поля — «сохранить реквизиты» не трогает город/био,
    # а явный null не стирает уже сохранённое.
    changes = {
        key: (value.strip() if isinstance(value, str) else value)
        for key, value in body.model_dump(exclude_unset=True).items()
        if value is not None
    }
    if not profile:
        profile = ContractorProfile(user_id=user.id, **changes)
        db.add(profile)
    else:
        for key, value in changes.items():
            setattr(profile, key, value)
    await db.commit()
    await db.refresh(profile)
    return {"ok": True, "id": profile.id}


@router.get("/job-leads")
async def list_leads(
    status: str | None = "open",
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    city: str | None = Query(None, max_length=64, description="Подстрока адреса/города"),
    renovation_type: RenovationType | None = None,
    budget_min: float | None = Query(None, ge=0),
    budget_max: float | None = Query(None, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(JobLead).order_by(JobLead.created_at.desc(), JobLead.id)
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
    if city and city.strip():
        q = q.where(JobLead.address.ilike(f"%{city.strip()}%"))
    if renovation_type:
        q = q.where(JobLead.renovation_type == renovation_type)
    if budget_min is not None:
        q = q.where(JobLead.budget_hint >= budget_min)
    if budget_max is not None:
        q = q.where(JobLead.budget_hint <= budget_max)
    rows = list((await db.execute(q.limit(limit).offset(offset))).scalars().all())
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
    if lead.assigned_contractor_id == user.id:
        # MKT-002: принятый отклик неизменяем — цена в шапке заявки и в отклике не расходится.
        raise HTTPException(409, "quote_locked_after_accept")
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
        if "note" in body.model_fields_set:
            existing.note = body.note
        quote = existing
    else:
        quote = JobLeadQuote(
            lead_id=lead_id,
            contractor_id=user.id,
            pre_estimate=body.pre_estimate,
            note=body.note,
        )
        db.add(quote)
    # Keep lead open until customer accepts a quote. Do NOT mirror the price onto
    # the shared lead row: it would leak one contractor's price to competitors.
    await db.commit()
    await db.refresh(quote)
    await _safe_notify(db, marketplace_notifications.notify_quote_received(db, lead=lead, quote=quote))
    return {"ok": True, "quote_id": quote.id, "pre_estimate": quote.pre_estimate, "awaiting_customer_pick": True}


@router.post("/job-leads/{lead_id}/quote/withdraw")
async def withdraw_quote(
    lead_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """MKT-005: исполнитель отзывает свой отклик, пока заявка не принята. Идемпотентно."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, "contractor_only")
    lead = await db.get(JobLead, lead_id)
    if not lead:
        raise HTTPException(404, "lead_not_found")
    if lead.assigned_contractor_id == user.id:
        raise HTTPException(409, "quote_locked_after_accept")
    result = await db.execute(
        delete(JobLeadQuote).where(
            JobLeadQuote.lead_id == lead_id, JobLeadQuote.contractor_id == user.id
        )
    )
    await db.commit()
    return {"ok": True, "withdrawn": bool(result.rowcount), "status": lead.status.value}


@router.post("/job-leads/{lead_id}/close")
async def close_lead(
    lead_id: str,
    body: LeadCloseIn | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """MKT-005: заказчик-владелец закрывает заявку; отклики перестают приниматься. Идемпотентно."""
    if user.role != UserRole.customer:
        raise HTTPException(403, "customer_only")
    lead = await db.get(JobLead, lead_id)
    if not lead or lead.customer_id != user.id:
        raise HTTPException(404, "lead_not_found")
    if lead.status == JobLeadStatus.taken:
        raise HTTPException(409, "lead_already_converted")
    first_close = lead.status != JobLeadStatus.closed
    if first_close:
        reason = ((body.reason if body else None) or "").strip() or None
        lead.status = JobLeadStatus.closed
        lead.closed_reason = reason
        lead.closed_at = utc_now()
        await db.commit()
        await _safe_notify(db, marketplace_notifications.notify_lead_closed(db, lead=lead))
    return {
        "ok": True,
        "status": lead.status.value,
        "reason": lead.closed_reason,
        "closed_reason": lead.closed_reason,
        "closed_at": lead.closed_at.isoformat() if lead.closed_at else None,
    }


@router.post("/job-leads/{lead_id}/decline-assignment")
async def decline_assignment(
    lead_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """MKT-005: назначенный исполнитель отказывается до конверсии; заявка снова open."""
    if user.role != UserRole.contractor:
        raise HTTPException(403, "contractor_only")
    lead = await db.get(JobLead, lead_id)
    if not lead or lead.assigned_contractor_id != user.id:
        raise HTTPException(404, "lead_not_found")
    if lead.status != JobLeadStatus.quoted:
        raise HTTPException(409, "lead_not_declinable")
    lead.assigned_contractor_id = None
    lead.pre_estimate = None
    lead.status = JobLeadStatus.open
    # Его отклик снимаем: иначе заказчик мог бы снова «принять» отказавшегося.
    await db.execute(
        delete(JobLeadQuote).where(
            JobLeadQuote.lead_id == lead_id, JobLeadQuote.contractor_id == user.id
        )
    )
    await db.commit()
    return {"ok": True, "status": lead.status.value}


@router.patch("/job-leads/{lead_id}")
async def update_lead(
    lead_id: str,
    body: LeadPatchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """MKT-005: заказчик правит заявку, пока она open и отклик не принят."""
    if user.role != UserRole.customer:
        raise HTTPException(403, "customer_only")
    lead = await db.get(JobLead, lead_id)
    if not lead or lead.customer_id != user.id:
        raise HTTPException(404, "lead_not_found")
    if lead.status != JobLeadStatus.open or lead.assigned_contractor_id:
        raise HTTPException(409, "lead_not_editable")
    changes = body.model_dump(exclude_unset=True)
    for required in ("title", "area_sqm", "renovation_type", "budget_hint"):
        if required in changes and changes[required] is None:
            raise HTTPException(422, f"{required}_required")
    for key, value in changes.items():
        setattr(lead, key, value)
    await db.commit()
    quotes = list(
        (await db.execute(select(JobLeadQuote).where(JobLeadQuote.lead_id == lead_id))).scalars().all()
    )
    return _lead_dict(lead, user, quotes)


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
    await _safe_notify(
        db, marketplace_notifications.notify_quote_decision(db, lead=lead, winner_id=quote.contractor_id)
    )
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
        .where(ContractorProfile.visible.is_(True), User.deleted_at.is_(None))
    )
    rows = (await db.execute(q)).all()
    ranked = reputation.ranked(rows, renovation_type=renovation_type, specialty=specialty)
    result = [
        {
            "id": profile.id,
            "profile_id": profile.id,
            "user_id": profile.user_id,
            "name": _public_name(contractor),
            "company": profile.company_name,
            "specialties": profile.specialties,
            "rating": reputation.public_rating(profile),
            "score": score,
            # Балл заказчику ни о чём не говорит — причина говорит.
            "match_basis": reputation.match_basis(
                profile, renovation_type=renovation_type, specialty=specialty
            ),
            "city": profile.city,
        }
        for profile, contractor, score in ranked
    ]
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
    image_key: str = Query(..., max_length=512),
    caption: str | None = Query(None, max_length=255),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role != UserRole.contractor:
        raise HTTPException(403, "contractor_only")
    profile = await db.get(ContractorProfile, profile_id)
    if not profile or profile.user_id != user.id:
        raise HTTPException(404, "contractor_profile_not_found")
    # MKT-024: ключ — только из собственного пространства портфолио пользователя.
    if not re.fullmatch(rf"portfolio/{re.escape(user.id)}/[A-Za-z0-9][A-Za-z0-9._-]{{0,199}}", image_key) or ".." in image_key:
        raise HTTPException(422, "invalid_image_key")
    photo = ContractorPortfolioPhoto(profile_id=profile_id, image_key=image_key, caption=caption)
    db.add(photo)
    await db.commit()
    await db.refresh(photo)
    return {"ok": True, "id": photo.id}


@router.get("/job-leads/{lead_id}/threads")
async def lead_threads(
    lead_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """MKT-010: заказчику — откликнувшиеся исполнители с их тредами (без телефонов и цен)."""
    lead = await db.get(JobLead, lead_id)
    if not lead or user.role != UserRole.customer or lead.customer_id != user.id:
        raise HTTPException(404, "lead_not_found")
    contractor_ids = list(
        (await db.execute(select(JobLeadQuote.contractor_id).where(JobLeadQuote.lead_id == lead_id))).scalars().all()
    )
    if lead.assigned_contractor_id and lead.assigned_contractor_id not in contractor_ids:
        contractor_ids.append(lead.assigned_contractor_id)
    users = {
        u.id: u
        for u in (await db.execute(select(User).where(User.id.in_(contractor_ids)))).scalars().all()
    } if contractor_ids else {}
    stats = {}
    if contractor_ids:
        for tid, count, last_at in (
            await db.execute(
                select(LeadMessage.thread_contractor_id, func.count(LeadMessage.id), func.max(LeadMessage.created_at))
                .where(LeadMessage.lead_id == lead_id, LeadMessage.thread_contractor_id.in_(contractor_ids))
                .group_by(LeadMessage.thread_contractor_id)
            )
        ).all():
            stats[tid] = (count, last_at)
    out = []
    for cid in contractor_ids:
        count, last_at = stats.get(cid, (0, None))
        out.append({
            "contractor_id": cid,
            "name": _public_name(users[cid]) if cid in users else ANONYMOUS_CONTRACTOR_NAME,
            "assigned": cid == lead.assigned_contractor_id,
            "message_count": count,
            "last_message_at": last_at.isoformat() if last_at else None,
        })
    return out


@router.get("/job-leads/{lead_id}/messages")
async def lead_messages(
    lead_id: str,
    contractor_id: str | None = Query(default=None, max_length=36),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(JobLead, lead_id)
    if not lead:
        raise HTTPException(404, "lead_not_found")
    tid = await _resolve_lead_thread(db, lead, user, contractor_id)
    rows = (
        await db.execute(
            select(LeadMessage)
            .where(LeadMessage.lead_id == lead_id, _thread_filter(lead, tid))
            .order_by(LeadMessage.created_at)
        )
    ).scalars().all()
    return [
        {
            "id": message.id,
            "user_id": message.user_id,
            "thread_contractor_id": tid,
            "text": message.text,
            "at": message.created_at.isoformat(),
        }
        for message in rows
    ]


@router.post("/job-leads/{lead_id}/messages")
async def post_lead_msg(
    lead_id: str,
    body: LeadMsgIn,
    contractor_id: str | None = Query(default=None, max_length=36),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    lead = await db.get(JobLead, lead_id)
    if not lead:
        raise HTTPException(404, "lead_not_found")
    tid = await _resolve_lead_thread(db, lead, user, contractor_id)
    if lead.assigned_contractor_id and tid != lead.assigned_contractor_id:
        # после выбора исполнителя треды проигравших закрыты для записи (читать можно)
        raise HTTPException(409, detail={
            "code": "lead_thread_closed",
            "message": "Заказчик выбрал другого исполнителя — этот тред закрыт.",
        })
    message = LeadMessage(lead_id=lead_id, user_id=user.id, thread_contractor_id=tid, text=body.text.strip())
    db.add(message)
    await db.commit()
    await db.refresh(message)
    await _safe_notify(
        db,
        marketplace_notifications.notify_lead_message(
            db, lead=lead, sender_id=user.id, text=message.text, thread_contractor_id=tid
        ),
    )
    return {"ok": True, "id": message.id, "thread_contractor_id": tid}


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
    if lead.assigned_contractor_id:
        # MKT-001: уже назначенную заявку не переназначаем (цена прежнего победителя).
        raise HTTPException(409, "lead_already_assigned")
    if lead.status != JobLeadStatus.open:
        raise HTTPException(409, "lead_not_assignable")

    # MKT-004: назначаем только по реальному основанию. Есть отклики — выбираем
    # из откликнувшихся (они согласны на заявку) по совпадению, затем по цене;
    # откликов нет — только исполнителей с совпадением по специализации/типу ремонта.
    quotes = list(
        (await db.execute(select(JobLeadQuote).where(JobLeadQuote.lead_id == lead_id))).scalars().all()
    )
    quote_by_user = {q.contractor_id: q for q in quotes}
    rows = (
        await db.execute(
            select(ContractorProfile, User)
            .join(User, User.id == ContractorProfile.user_id)
            .where(
                ContractorProfile.visible.is_(True),
                User.deleted_at.is_(None),
                User.role == UserRole.contractor,
            )
        )
    ).all()
    ranked = reputation.ranked(rows, renovation_type=lead.renovation_type)
    if quote_by_user:
        by_user = {r[1].id: r for r in ranked}
        # Откликнувшийся без публичного профиля тоже кандидат: он сам предложил цену.
        for u in (
            await db.execute(
                select(User).where(
                    User.id.in_(list(quote_by_user)),
                    User.deleted_at.is_(None),
                    User.role == UserRole.contractor,
                )
            )
        ).scalars():
            by_user.setdefault(u.id, (None, u, 0.0))
        candidates = list(by_user[uid] for uid in quote_by_user if uid in by_user)
        candidates.sort(key=lambda r: (-r[2], quote_by_user[r[1].id].pre_estimate, r[1].id))
    else:
        candidates = [r for r in ranked if r[2] > 0]
    if not candidates:
        raise HTTPException(404, "no_matching_contractors")
    best_profile, best_user, best_score = candidates[0]
    winner_quote = quote_by_user.get(best_user.id)

    lead.assigned_contractor_id = best_user.id
    # Цена — только победителя; без его отклика цены нет (не чужая).
    lead.pre_estimate = winner_quote.pre_estimate if winner_quote else None
    lead.status = JobLeadStatus.quoted
    await db.commit()
    await _safe_notify(
        db, marketplace_notifications.notify_quote_decision(db, lead=lead, winner_id=best_user.id)
    )
    return {
        "contractor_id": best_user.id,
        "name": _public_name(best_user),
        "match_basis": reputation.match_basis(best_profile, renovation_type=lead.renovation_type)
        if best_profile is not None
        else "Исполнитель сам откликнулся на заявку",
        "score": best_score,
        "status": lead.status.value,
        "pre_estimate": lead.pre_estimate,
        "source": "quote" if winner_quote else "match",
    }
