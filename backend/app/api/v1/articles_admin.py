from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_access import require_admin_user
from app.db.session import get_db
from app.models.entities import RepairArticle, User

router = APIRouter(prefix="/articles/admin", tags=["articles-admin"])


class ArticleIn(BaseModel):
    slug: str = Field(min_length=1, max_length=160, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    title: str = Field(min_length=1, max_length=255)
    category: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1000)
    body: str = Field(min_length=1)
    tags: str = Field(default="", max_length=1000)
    read_min: int = Field(default=3, ge=1, le=240)


@router.get("")
async def list_articles_admin(
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RepairArticle).order_by(RepairArticle.created_at.desc())
    )
    return [
        {
            "slug": article.slug,
            "title": article.title,
            "category": article.category,
            "published": article.published,
        }
        for article in result.scalars().all()
    ]


@router.delete("/{slug}")
async def unpublish_article(
    slug: str,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    article = (
        await db.execute(select(RepairArticle).where(RepairArticle.slug == slug))
    ).scalar_one_or_none()
    if article is None:
        raise HTTPException(404, detail={"code": "article_not_found"})
    if not article.published:
        return {"ok": True, "slug": article.slug, "published": False, "replayed": True}
    article.published = False
    await db.commit()
    return {"ok": True, "slug": article.slug, "published": False, "replayed": False}


@router.post("")
async def create_article(
    body: ArticleIn,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.scalar(
        select(RepairArticle.id).where(RepairArticle.slug == body.slug)
    )
    if existing is not None:
        raise HTTPException(409, detail={"code": "article_slug_conflict"})
    article = RepairArticle(**body.model_dump(), published=True)
    db.add(article)
    try:
        await db.commit()
        await db.refresh(article)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, detail={"code": "article_slug_conflict"}) from exc
    return {"id": article.id, "slug": article.slug, "published": True}


@router.patch("/{slug}")
async def update_article(
    slug: str,
    body: ArticleIn,
    user: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_db),
):
    article = (
        await db.execute(select(RepairArticle).where(RepairArticle.slug == slug))
    ).scalar_one_or_none()
    if article is None:
        raise HTTPException(404, detail={"code": "article_not_found"})
    if body.slug != slug:
        conflict = await db.scalar(
            select(RepairArticle.id).where(
                RepairArticle.slug == body.slug,
                RepairArticle.id != article.id,
            )
        )
        if conflict is not None:
            raise HTTPException(409, detail={"code": "article_slug_conflict"})
    for key, value in body.model_dump().items():
        setattr(article, key, value)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, detail={"code": "article_slug_conflict"}) from exc
    return {"ok": True, "slug": article.slug, "published": article.published}
