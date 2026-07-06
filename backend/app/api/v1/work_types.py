from fastapi import APIRouter
from app.data.work_types import WORK_TYPES
router = APIRouter(prefix="/work-types", tags=["work-types"])
@router.get("")
async def list_work_types(category: str | None = None):
    if category:
        return [w for w in WORK_TYPES if w["category"] == category]
    return WORK_TYPES
