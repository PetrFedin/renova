"""API планировщика бюджета и рыночных оценок."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import budget_planner_service as bp

router = APIRouter(tags=["budget-planner"])


class MarketEstimateIn(BaseModel):
    region_code: str = "moscow"
    work_types: list[str] = Field(min_length=1)
    floor_sq_m: float = 12
    wall_sq_m: float = 24
    perimeter_m: float = 14
    outlets_count: int = 0
    plumbing_points: int = 0
    complexity: float = 1.0
    labor_share: float | None = None


@router.get("/market/regions")
async def market_regions():
    return bp.list_regions()


@router.post("/market/estimate")
async def market_estimate(body: MarketEstimateIn):
    metrics = {
        "floor_sq_m": body.floor_sq_m,
        "wall_sq_m": body.wall_sq_m,
        "perimeter_m": body.perimeter_m,
        "outlets_count": body.outlets_count,
        "plumbing_points": body.plumbing_points,
    }
    return bp.estimate_market(
        region_code=body.region_code,
        work_types=body.work_types,
        metrics=metrics,
        complexity=body.complexity,
        labor_share_override=body.labor_share,
    )


@router.post("/projects/{project_id}/budget/market-estimate")
async def project_market_estimate(
    project_id: str,
    body: MarketEstimateIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    p = await require_project(db, project_id, user, write=False)
    metrics = {
        "floor_sq_m": body.floor_sq_m,
        "wall_sq_m": body.wall_sq_m,
        "perimeter_m": body.perimeter_m,
        "outlets_count": body.outlets_count,
        "plumbing_points": body.plumbing_points,
    }
    if p.rooms:
        r = p.rooms[0]
        from app.services import room_service as rs
        det = rs.room_detail(r)
        metrics = {
            "floor_sq_m": det["floor_sq_m"],
            "wall_sq_m": det["wall_sq_m"],
            "perimeter_m": det["perimeter_m"],
            "outlets_count": getattr(r, "outlets_count", 0) or 0,
            "plumbing_points": getattr(r, "plumbing_points", 0) or 0,
        }
    return bp.estimate_market(
        region_code=body.region_code,
        work_types=body.work_types,
        metrics=metrics,
        complexity=body.complexity,
        labor_share_override=body.labor_share,
    )
