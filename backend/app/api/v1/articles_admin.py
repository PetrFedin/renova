from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.entities import RepairArticle, User, UserRole

router = APIRouter(prefix="/articles/admin", tags=["articles-admin"])

class ArticleIn(BaseModel):
    slug: str
    title: str
    category: str
    summary: str
    body: str
    tags: str = ""
    read_min: int = 3

@router.get("")
async def list_articles_admin(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    from sqlalchemy import select
    r = await db.execute(select(RepairArticle).order_by(RepairArticle.created_at.desc()))
    return [{"slug": a.slug, "title": a.title, "category": a.category, "published": a.published} for a in r.scalars().all()]

@router.delete("/{slug}")
async def delete_article(slug: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    from sqlalchemy import select
    r = await db.execute(select(RepairArticle).where(RepairArticle.slug == slug))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404)
    a.published = False
    await db.commit()
    return {"ok": True}

@router.post("")
async def create_article(body: ArticleIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    a = RepairArticle(**body.model_dump(), published=True)
    db.add(a)
    await db.commit()
    return {"id": a.id, "slug": a.slug}

@router.patch("/{slug}")
async def update_article(slug: str, body: ArticleIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role != UserRole.contractor:
        raise HTTPException(403)
    from sqlalchemy import select
    r = await db.execute(select(RepairArticle).where(RepairArticle.slug == slug))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    await db.commit()
    return {"ok": True}
