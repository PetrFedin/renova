"""Сид статей в БД."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.data.repair_articles import ARTICLES
from app.models.entities import RepairArticle


async def seed_articles(db: AsyncSession) -> None:
    r = await db.execute(select(RepairArticle).limit(1))
    if r.scalar_one_or_none():
        return
    for a in ARTICLES:
        db.add(
            RepairArticle(
                slug=a["slug"],
                title=a["title"],
                category=a["category"],
                tags=",".join(a["tags"]),
                read_min=a["read_min"],
                summary=a["summary"],
                body=a["body"],
            )
        )
    await db.commit()
