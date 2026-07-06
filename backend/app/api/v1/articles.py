"""Статьи — из БД с fallback на статику."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.entities import RepairArticle
from app.data.repair_articles import ARTICLES as STATIC, CATEGORIES

router = APIRouter(prefix="/articles", tags=["articles"])


def _from_static():
    return [
        {
            "slug": a["slug"], "title": a["title"], "category": a["category"],
            "category_label": CATEGORIES.get(a["category"], a["category"]),
            "tags": a["tags"], "read_min": a["read_min"], "summary": a["summary"],
        }
        for a in STATIC
    ]


@router.get("")
async def list_articles(category: str | None = Query(None), db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(RepairArticle).where(RepairArticle.published.is_(True)))
    rows = list(r.scalars().all())
    if not rows:
        items = _from_static()
    else:
        items = [
            {
                "slug": a.slug, "title": a.title, "category": a.category,
                "category_label": CATEGORIES.get(a.category, a.category),
                "tags": (a.tags or "").split(","), "read_min": a.read_min, "summary": a.summary,
            }
            for a in rows
        ]
    if category:
        items = [i for i in items if i["category"] == category]
    return items


@router.get("/categories")
async def list_categories():
    return [{"id": k, "label": v} for k, v in CATEGORIES.items()]


@router.get("/{slug}")
async def get_article(slug: str, db: AsyncSession = Depends(get_db)):
    r = await db.execute(select(RepairArticle).where(RepairArticle.slug == slug))
    a = r.scalar_one_or_none()
    if a:
        return {
            "slug": a.slug, "title": a.title, "category": a.category,
            "category_label": CATEGORIES.get(a.category, a.category),
            "tags": (a.tags or "").split(","), "read_min": a.read_min,
            "summary": a.summary, "body": a.body,
        }
    static = next((x for x in STATIC if x["slug"] == slug), None)
    if not static:
        raise HTTPException(404)
    return {**static, "category_label": CATEGORIES.get(static["category"], static["category"])}
