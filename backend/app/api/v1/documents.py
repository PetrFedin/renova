"""Document Center: единый индекс документов поверх существующих источников."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import AcceptanceStatus, DesignPackage, Receipt, Stage, User, WorkAcceptance

router = APIRouter(prefix="/projects", tags=["documents"])


def export_doc(project_id: str, kind: str, title: str, href: str) -> dict:
    return {
        "id": f"export:{kind}",
        "source": "export",
        "kind": kind,
        "title": title,
        "status": "ready",
        "href": href,
        "created_at": None,
        "amount": None,
        "verified": None,
        "version": None,
        "meta": {"project_id": project_id},
    }


@router.get("/{project_id}/documents")
async def list_project_documents(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project(db, project_id, user, write=False)
    docs: list[dict] = []

    design_rows = list(
        (
            await db.execute(
                select(DesignPackage)
                .where(DesignPackage.project_id == project_id)
                .order_by(DesignPackage.version.desc(), DesignPackage.created_at.desc())
            )
        ).scalars().all()
    )
    for item in design_rows:
        docs.append({
            "id": f"design:{item.id}",
            "source": "design",
            "kind": "design_package",
            "title": f"Дизайн v{item.version}: {item.title}",
            "status": item.status,
            "href": f"/api/v1/media/{item.file_key}" if item.file_key else None,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "amount": None,
            "verified": None,
            "version": item.version,
            "meta": {"notes": item.notes, "file_key": item.file_key},
        })

    acceptance_rows = list(
        (
            await db.execute(
                select(WorkAcceptance, Stage)
                .join(Stage, Stage.id == WorkAcceptance.stage_id)
                .where(WorkAcceptance.project_id == project_id)
                .where(WorkAcceptance.status.in_([
                    AcceptanceStatus.accepted.value,
                    AcceptanceStatus.accepted_with_remarks.value,
                ]))
                .order_by(WorkAcceptance.accepted_at.desc(), WorkAcceptance.created_at.desc())
            )
        ).all()
    )
    for acceptance, stage in acceptance_rows:
        docs.append({
            "id": f"acceptance:{acceptance.id}",
            "source": "acceptance",
            "kind": "stage_acceptance_act",
            "title": f"Акт приёмки: {stage.name}",
            "status": acceptance.status,
            "href": f"/api/v1/projects/{project_id}/stages/{stage.id}/acceptance.pdf",
            "created_at": (
                acceptance.accepted_at.isoformat()
                if acceptance.accepted_at
                else acceptance.created_at.isoformat() if acceptance.created_at else None
            ),
            "amount": stage.payment_amount,
            "verified": True,
            "version": None,
            "meta": {
                "stage_id": stage.id,
                "quality_score": acceptance.quality_score,
                "comment": acceptance.comment,
                "accepted_by": acceptance.accepted_by,
            },
        })

    receipt_rows = list(
        (
            await db.execute(
                select(Receipt)
                .where(Receipt.project_id == project_id)
                .order_by(Receipt.created_at.desc())
            )
        ).scalars().all()
    )
    for item in receipt_rows:
        title = item.qr_raw if item.fn == "MANUAL" and item.qr_raw else "Фискальный чек"
        docs.append({
            "id": f"receipt:{item.id}",
            "source": "receipt",
            "kind": "receipt",
            "title": title[:80],
            "status": "verified" if item.fns_verified else "unverified",
            "href": None,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "amount": item.amount,
            "verified": item.fns_verified,
            "version": None,
            "meta": {
                "category": item.expense_category,
                "room_id": item.room_id,
                "stage_id": item.stage_id,
                "payment_id": item.payment_id,
                "source": "manual" if item.fn == "MANUAL" else "scan",
            },
        })

    docs.extend([
        export_doc(project_id, "project_pdf", "Полный отчёт проекта", f"/api/v1/projects/{project_id}/export.pdf"),
        export_doc(project_id, "full_dossier_pdf", "Полное досье проекта", f"/api/v1/projects/{project_id}/full-dossier.pdf"),
        export_doc(project_id, "activity_dossier_pdf", "Досье событий", f"/api/v1/projects/{project_id}/activity-dossier.pdf"),
        export_doc(project_id, "estimate_pdf", "Смета PDF", f"/api/v1/projects/{project_id}/estimate.pdf"),
        export_doc(project_id, "estimate_csv", "Смета CSV", f"/api/v1/projects/{project_id}/estimate.csv"),
        export_doc(project_id, "estimate_xlsx", "Смета Excel", f"/api/v1/projects/{project_id}/estimate.xlsx"),
        export_doc(project_id, "kpi_weekly_pdf", "Еженедельный KPI-отчёт", f"/api/v1/projects/{project_id}/kpi-weekly.pdf"),
    ])

    docs.sort(
        key=lambda item: (
            item.get("created_at") is not None,
            item.get("created_at") or "",
        ),
        reverse=True,
    )
    return {
        "project_id": project_id,
        "project_name": project.name,
        "items": docs,
        "counts": {
            "total": len(docs),
            "design": len([item for item in docs if item["source"] == "design"]),
            "acceptances": len([item for item in docs if item["source"] == "acceptance"]),
            "receipts": len([item for item in docs if item["source"] == "receipt"]),
            "exports": len([item for item in docs if item["source"] == "export"]),
        },
    }
