"""PDF и экспорт проекта — fpdf2 с транслитерацией кириллицы."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_project
from app.db.session import get_db
from app.models.entities import User
from app.services import project_service as proj_svc
from app.services.pdf_helper import new_pdf, pdf_line, pdf_response

router = APIRouter(prefix="/projects", tags=["export"])


@router.get("/{project_id}/estimate.pdf")
async def export_pdf(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    pdf = new_pdf()
    pdf_line(pdf, f"Смета: {p.name}", size=14)
    for line in p.estimate_lines:
        total = line.quantity_planned * line.unit_price
        pdf_line(pdf, f"{line.name} | {line.quantity_planned} {line.unit} x {line.unit_price} = {total:.0f} RUB")
    pdf_line(pdf, f"ИТОГО: {p.budget_planned:.0f} ₽", size=11)
    return pdf_response(pdf, f"estimate-{project_id[:8]}.pdf")


@router.get("/{project_id}/stages/{stage_id}/acceptance.pdf")
async def export_acceptance(project_id: str, stage_id: str, checks: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import stage_service as st_svc

    await require_project(db, project_id, user, write=False)
    stage = await st_svc.get_stage_full(db, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404)
    pdf = new_pdf()
    pdf_line(pdf, f"Priyomka: {stage.name}", size=14)
    pdf_line(pdf, f"Status: {stage.status.value}")
    pdf_line(pdf, f"Oplata: {stage.payment_amount:.0f} RUB")
    if stage.customer_accepted_at:
        pdf_line(pdf, f"Prinyato: {stage.customer_accepted_at.isoformat()[:10]}")
    if checks:
        pdf_line(pdf, "Checklist:", size=11)
        for item in checks.split("|"):
            pdf_line(pdf, f"[x] {item}")
    pdf_line(pdf, "Photos:", size=11)
    for photo in stage.photos[:10]:
        pdf_line(pdf, f"- {photo.caption or 'photo'} ({photo.created_at.date()})")
    return pdf_response(pdf, f"acceptance-{stage_id[:8]}.pdf")


@router.get("/{project_id}/rooms/{room_id}/export.pdf")
async def export_room_pdf(project_id: str, room_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.entities import Room
    from app.services.room_service import room_detail

    await require_project(db, project_id, user, write=False)
    room = await db.get(Room, room_id)
    if not room or room.project_id != project_id:
        raise HTTPException(404)
    d = room_detail(room)
    pdf = new_pdf()
    pdf_line(pdf, f"Komnata: {d['name']}", size=14)
    pdf_line(pdf, f"Size: {d['length_m']}x{d['width_m']} h{d['height_m']}")
    pdf_line(pdf, f"Floor: {d['floor_sq_m']} m2 | Walls: {d['wall_sq_m']} m2")
    pdf_line(pdf, f"Outlets: {d['outlets_count']} | Plumbing: {d['plumbing_points']}")
    return pdf_response(pdf, f"room-{room_id[:8]}.pdf")


@router.get("/{project_id}/export.pdf")
async def export_project_pdf(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    pdf = new_pdf()
    pdf_line(pdf, f"Проект: {p.name}", size=14)
    pdf_line(pdf, f"Бюджет: {p.budget_planned:.0f} / {p.budget_spent:.0f} ₽")
    for room in getattr(p, "rooms", None) or []:
        pdf_line(pdf, f"Комната: {room.name}")
    for st in p.stages or []:
        pdf_line(pdf, f"Etap: {st.name} [{st.status.value}]")
    return pdf_response(pdf, f"project-{project_id[:8]}.pdf")


@router.get("/{project_id}/estimate.csv")
async def export_estimate_csv(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await require_project(db, project_id, user, write=False)
    lines = ["name,unit,qty_plan,qty_fact,unit_price,total"]
    for line in p.estimate_lines:
        lines.append(f"{line.name},{line.unit},{line.quantity_planned},{line.quantity_actual},{line.unit_price},{line.quantity_planned * line.unit_price}")
    body = "\n".join(lines)
    return Response(body, media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=estimate-{project_id[:8]}.csv"})


@router.get("/{project_id}/estimate.xlsx")
async def export_xlsx(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from itertools import groupby

    p = await require_project(db, project_id, user, write=False)
    total = sum(line.quantity_planned * line.unit_price for line in p.estimate_lines)
    sorted_lines = sorted(p.estimate_lines, key=lambda x: x.room_name or "Obschee")
    rows = ""
    for room, grp in groupby(sorted_lines, key=lambda x: x.room_name or "Obschee"):
        rows += f"<Row><Cell><Data>[{room}]</Data></Cell></Row>"
        for line in grp:
            rows += f"<Row><Cell><Data>{line.name}</Data></Cell><Cell><Data>{line.quantity_planned}</Data></Cell><Cell><Data>{line.unit_price}</Data></Cell><Cell><Data>{line.quantity_planned * line.unit_price * 0.2:.0f}</Data></Cell></Row>"
    xml = (
        '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>'
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">'
        f'<Worksheet ss:Name="Estimate" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Table>{rows}'
        f"<Row><Cell><Data>TOTAL</Data></Cell><Cell/><Cell/><Cell><Data>{total * 0.2:.0f}</Data></Cell>"
        f"<Cell><Data>{total * 1.2:.0f}</Data></Cell></Row></Table></Worksheet></Workbook>"
    )
    return Response(xml.encode("utf-8"), media_type="application/vnd.ms-excel", headers={"Content-Disposition": f"attachment; filename=estimate-{project_id[:8]}.xls"})


@router.get("/{project_id}/rooms/{room_id}/audit.pdf")
async def export_room_audit(project_id: str, room_id: str, field: str | None = None, since: str | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import datetime as dt
    from sqlalchemy import select
    from app.models.entities import Room, RoomChangeLog

    await require_project(db, project_id, user, write=False)
    room = await db.get(Room, room_id)
    if not room or room.project_id != project_id:
        raise HTTPException(404)
    q = select(RoomChangeLog).where(RoomChangeLog.room_id == room_id)
    if field:
        q = q.where(RoomChangeLog.field_name == field)
    if since:
        q = q.where(RoomChangeLog.created_at >= dt.fromisoformat(since))
    logs = (await db.execute(q.order_by(RoomChangeLog.created_at))).scalars().all()
    pdf = new_pdf()
    pdf_line(pdf, f"Audit: {room.name}", size=14)
    for lg in logs:
        pdf_line(pdf, f"{lg.created_at.date()} {lg.field_name}: {lg.old_value} -> {lg.new_value}")
    return pdf_response(pdf, f"audit-{room_id[:8]}.pdf")


@router.get("/{project_id}/kpi-weekly.pdf")
async def export_kpi_weekly(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from datetime import datetime, timedelta
    from sqlalchemy import select
    from app.models.entities import MarginSnapshot

    p = await require_project(db, project_id, user, write=False)
    since = datetime.utcnow() - timedelta(days=7)
    r = await db.execute(select(MarginSnapshot).where(MarginSnapshot.project_id == project_id, MarginSnapshot.recorded_at >= since))
    snaps = list(r.scalars().all())
    pdf = new_pdf()
    pdf_line(pdf, f"KPI week: {p.name}", size=14)
    pdf_line(pdf, f"Marzha: {p.budget_planned - p.budget_spent:.0f}")
    vals = [s.margin_estimated for s in snaps] or [0]
    mx = max(vals) or 1
    pdf_line(pdf, "Sparkline:", size=11)
    bar = "".join(chr(9608) * max(1, int(v / mx * 8)) if v else "." for v in vals)
    pdf_line(pdf, f"BAR {bar}", size=9)
    for s in snaps:
        pdf_line(pdf, f"{s.recorded_at.date()}: {s.margin_estimated:.0f}")
    return pdf_response(pdf, f"kpi-{project_id[:8]}.pdf")


@router.get("/{project_id}/activity-dossier.pdf")
async def export_dossier(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import activity_service as act

    p = await require_project(db, project_id, user, write=False)
    items = await act.project_feed(db, project_id, limit=100)
    pdf = new_pdf()
    pdf_line(pdf, f"Dossier: {p.name}", size=14)
    for it in items:
        pdf_line(pdf, f"{it.get('at', '')[:10]} | {it.get('kind')} | {it.get('title')}", size=9)
    return pdf_response(pdf, f"dossier-{project_id[:8]}.pdf")


@router.get("/{project_id}/full-dossier.pdf")
async def full_dossier(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.services import activity_service as act

    p = await require_project(db, project_id, user, write=False)
    items = await act.project_feed(db, project_id, limit=50)
    pdf = new_pdf()
    pdf_line(pdf, f"Full dossier: {p.name}", size=14)
    pdf_line(pdf, f"Byudzhet: {p.budget_planned:.0f} / spent {p.budget_spent:.0f}")
    for line in p.estimate_lines[:30]:
        pdf_line(pdf, f"- {line.name}: {line.quantity_planned * line.unit_price:.0f}")
    pdf_line(pdf, "Activity:", size=11)
    for it in items[:40]:
        pdf_line(pdf, f"{it.get('at', '')[:10]} {it.get('title', '')}", size=8)
    return pdf_response(pdf, f"full-{project_id[:8]}.pdf")


@router.get("/{project_id}/export/1c-payments.csv")
async def export_1c_payments_csv(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """P4.1a: платежи + CO для 1С (CSV ;)."""
    from app.services.integrations.onec_export import build_1c_payments_csv

    project = await require_project(db, project_id, user, write=False)
    body = await build_1c_payments_csv(db, project)
    return Response(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=renova-1c-{project_id[:8]}.csv"},
    )


@router.get("/{project_id}/export/1c-commerceml.xml")
async def export_1c_commerceml(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """P4.1a++: CommerceML 2.04 subset для 1С."""
    from app.services.integrations.onec_export import build_1c_commerceml_xml

    project = await require_project(db, project_id, user, write=False)
    body = await build_1c_commerceml_xml(db, project)
    return Response(
        body.encode("utf-8") if isinstance(body, str) else body,
        media_type="application/xml; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=renova-cml-{project_id[:8]}.xml"},
    )


@router.get("/{project_id}/export/1c-payments.xml")
async def export_1c_payments_xml(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """P4.1a+: XML для 1С (RenovaExchange)."""
    from app.services.integrations.onec_export import build_1c_payments_xml

    project = await require_project(db, project_id, user, write=False)
    body = await build_1c_payments_xml(db, project)
    return Response(
        body,
        media_type="application/xml; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=renova-1c-{project_id[:8]}.xml"},
    )


@router.get("/{project_id}/export/bank-register.csv")
async def export_bank_register_csv(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """P4.1b: реестр оплат для сверки с банком."""
    from app.services.integrations.onec_export import build_bank_register_csv

    project = await require_project(db, project_id, user, write=False)
    body = await build_bank_register_csv(db, project)
    return Response(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=renova-bank-{project_id[:8]}.csv"},
    )


@router.get("/{project_id}/digest/weekly/preview")
async def preview_weekly_digest(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """W51: превью дайджеста без push — для демо и Отчётов."""
    from app.services import report_service as rep
    from app.services.digest_lite_service import compose_weekly_digest

    project = await require_project(db, project_id, user, write=False)
    weekly = await rep.weekly_report(db, project_id)
    composed = await compose_weekly_digest(db, project_name=project.name, weekly=weekly or {})
    return {
        "ok": True,
        **composed,
        "kpi_path": f"/api/v1/projects/{project_id}/kpi-weekly.pdf",
    }


@router.post("/{project_id}/digest/weekly")
async def push_weekly_digest(project_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """P2.5/W51: push rule-based (или Ollama) + ссылка на KPI PDF; архив в документах."""
    from app.services import notification_service as notif
    from app.services import report_service as rep
    from app.services import project_document_service as docs_svc
    from app.services.digest_lite_service import compose_weekly_digest
    from app.models.project_documents import DocumentType

    project = await require_project(db, project_id, user, write=True)
    weekly = await rep.weekly_report(db, project_id)
    composed = await compose_weekly_digest(db, project_name=project.name, weekly=weekly or {})
    members = [x for x in {project.customer_id, project.contractor_id, user.id} if x]
    title = composed["title"]
    body = composed["push_body"]
    for uid in members:
        role_reports = "/reports" if uid else "/documents"
        await notif.notify(
            db,
            user_id=uid,
            project_id=project_id,
            notification_type="document",
            title=title,
            body=body,
            link_path=role_reports,
            return_to="/documents",
        )
    # Архив текста в Document Center (без PDF blob — KPI отдельно)
    kpi_path = f"/api/v1/projects/{project_id}/kpi-weekly.pdf"
    doc = await docs_svc.create_document(
        db,
        project_id=project_id,
        created_by=user.id,
        document_type=DocumentType.other.value,
        title=f"Дайджест {composed['generated_at'][:10]}",
        notes=composed["body"][:4000],
        href=kpi_path,
    )
    await db.commit()
    return {
        "ok": True,
        "notified": len(members),
        "kpi_path": kpi_path,
        "ai_narrative": composed["source"] == "ollama",
        "source": composed["source"],
        "mode": composed["mode"],
        "body": composed["body"],
        "document_id": doc.id,
    }


class WarrantyClaimIn(BaseModel):
    title: str = Field(default="Гарантийное обращение", min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)


@router.post("/{project_id}/warranty-claims")
async def create_warranty_claim(
    project_id: str,
    body: WarrantyClaimIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """P5.1 lite: гарантийный тикет = issue + черновик документа warranty."""
    from app.models.entities import ProjectIssue
    from app.models.project_documents import DocumentStatus, DocumentType
    from app.services import project_document_service as docs_svc
    from app.services import activity_service as act
    from app.services import notification_service as notif

    project = await require_project(db, project_id, user, write=True)
    issue = ProjectIssue(
        project_id=project_id,
        title=f"[Гарантия] {body.title}"[:255],
        description=body.description,
        severity="high",
        status="open",
    )
    db.add(issue)
    await db.flush()
    draft = await docs_svc.create_document(
        db,
        project_id=project_id,
        created_by=user.id,
        title=f"Гарантия: {body.title}"[:200],
        document_type=DocumentType.warranty.value,
        notes=f"warranty_issue:{issue.id}",
    )
    draft.status = DocumentStatus.draft.value
    await db.flush()
    # W55: заказчик → Document Center; исполнитель → QC
    creator_link = "/quality-control" if user.role.value == "contractor" else "/documents"
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="WarrantyClaim",
        title=issue.title,
        body=body.description,
        link_path=creator_link,
    )
    other = project.contractor_id if user.id == project.customer_id else project.customer_id
    if other:
        other_is_contractor = other == project.contractor_id
        await notif.notify(
            db,
            user_id=other,
            project_id=project_id,
            notification_type="issue",
            title=issue.title,
            body=body.description or "Новое гарантийное обращение",
            link_path="/quality-control" if other_is_contractor else "/documents",
            return_to="/(contractor)/(tabs)/home" if other_is_contractor else "/(customer)/(tabs)/home",
        )
    await db.commit()
    return {
        "ok": True,
        "issue_id": issue.id,
        "document_id": draft.id,
        "qc_path": f"/quality-control?issueId={issue.id}",
    }


@router.get("/{project_id}/warranty-claims")
async def list_warranty_claims(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """P5.1: список гарантийных обращений (issues с префиксом [Гарантия])."""
    from app.services import issue_service as iss

    await require_project(db, project_id, user, write=False)
    items = await iss.list_issues(db, project_id, status=None)
    warranty = [iss.issue_dict(i) for i in items if (i.title or "").startswith("[Гарантия]")]
    return {"items": warranty, "open": sum(1 for i in warranty if i.get("status") != "closed")}


@router.post("/{project_id}/warranty-claims/{issue_id}/close")
async def close_warranty_claim(
    project_id: str,
    issue_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Закрыть гарантийное обращение."""
    from datetime import datetime
    from app.models.entities import ProjectIssue
    from app.services import issue_service as iss
    from app.services import activity_service as act

    await require_project(db, project_id, user, write=True)
    issue = await db.get(ProjectIssue, issue_id)
    if not issue or issue.project_id != project_id:
        raise HTTPException(404, "warranty_not_found")
    if not (issue.title or "").startswith("[Гарантия]"):
        raise HTTPException(400, "not_a_warranty_claim")
    issue.status = "closed"
    issue.closed_at = datetime.utcnow()
    # W46: архивируем связанный warranty-документ
    try:
        from sqlalchemy import select
        from app.models.project_documents import ProjectDocument, DocumentStatus, DocumentType
        docs = (
            await db.execute(
                select(ProjectDocument).where(
                    ProjectDocument.project_id == project_id,
                    ProjectDocument.document_type == DocumentType.warranty.value,
                    ProjectDocument.notes.contains(f"warranty_issue:{issue.id}"),
                )
            )
        ).scalars().all()
        for doc in docs:
            if doc.status != DocumentStatus.archived.value:
                doc.status = DocumentStatus.archived.value
    except Exception:
        pass
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="WarrantyClosed",
        title=issue.title,
        link_path="/documents" if user.role.value == "customer" else "/quality-control",
    )
    await db.commit()
    await db.refresh(issue)
    return {"ok": True, "issue": iss.issue_dict(issue)}



async def _closeout_snapshot(db, project_id: str, project) -> dict:
    from sqlalchemy import select
    from app.models.entities import Stage, StageStatus, Payment, PaymentStatus, ProjectIssue
    from app.models.project_documents import ProjectDocument, DocumentStatus

    stages = list((await db.execute(select(Stage).where(Stage.project_id == project_id))).scalars().all())
    stages_done = all(s.status == StageStatus.done for s in stages) if stages else False
    payments = list((await db.execute(select(Payment).where(Payment.project_id == project_id))).scalars().all())
    pending_pay = [p for p in payments if p.status == PaymentStatus.pending]
    acts = list(
        (
            await db.execute(
                select(ProjectDocument).where(
                    ProjectDocument.project_id == project_id,
                    ProjectDocument.document_type == "acceptance_act",
                )
            )
        ).scalars().all()
    )
    acts_active = [
        d for d in acts
        if (d.status.value if hasattr(d.status, "value") else d.status)
        in (DocumentStatus.active.value, DocumentStatus.archived.value, "active", "archived")
    ]
    warranty_open = list(
        (
            await db.execute(
                select(ProjectIssue).where(
                    ProjectIssue.project_id == project_id,
                    ProjectIssue.title.startswith("[Гарантия]"),
                    ProjectIssue.status != "closed",
                )
            )
        ).scalars().all()
    )
    ready = bool(stages_done and not pending_pay and len(warranty_open) == 0)
    return {
        "project_id": project_id,
        "project_name": project.name,
        "stages_total": len(stages),
        "stages_done": sum(1 for s in stages if s.status == StageStatus.done),
        "all_stages_done": stages_done,
        "pending_payments": len(pending_pay),
        "acceptance_acts": len(acts),
        "acceptance_acts_active": len(acts_active),
        "warranty_open": len(warranty_open),
        "ready": ready,
        "archived": bool(getattr(project, "is_archived", False)),
        "next_action": (
            "Объект уже в архиве"
            if bool(getattr(project, "is_archived", False))
            else (
                "Можно завершить объект"
                if ready
                else (
                    "Закройте этапы"
                    if not stages_done
                    else ("Подтвердите оплаты" if pending_pay else "Закройте гарантийные обращения")
                )
            )
        ),
    }


@router.get("/{project_id}/closeout-checklist")
async def closeout_checklist(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W46 lite: готовность объекта к завершению."""
    project = await require_project(db, project_id, user, write=False)
    return await _closeout_snapshot(db, project_id, project)


@router.post("/{project_id}/closeout")
async def closeout_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W46: завершить объект при ready — помечаем archived если поле есть."""
    from datetime import datetime
    from app.services import activity_service as act

    project = await require_project(db, project_id, user, write=True)
    snap = await _closeout_snapshot(db, project_id, project)
    if not snap["ready"]:
        raise HTTPException(409, detail={"code": "closeout_not_ready", **snap})
    project.is_archived = True
    await act.log_event(
        db,
        project_id=project_id,
        user_id=user.id,
        kind="ProjectCloseout",
        title=f"Объект завершён: {project.name}",
        link_path="/(customer)/(tabs)/home",
    )
    await db.commit()
    snap["archived"] = True
    snap["next_action"] = "Объект завершён"
    return {"ok": True, **snap}


class BankStatementIn(BaseModel):
    csv_text: str = Field(min_length=1, max_length=2_000_000)


@router.post("/{project_id}/import/bank-statement")
async def import_bank_statement(
    project_id: str,
    body: BankStatementIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """P4.1b: CSV выписки → матч к платежам (сумма ±1 ₽, дата ±3 дня)."""
    from app.services.integrations.bank_import import match_bank_rows_to_payments, parse_bank_statement_csv

    project = await require_project(db, project_id, user, write=False)
    rows = parse_bank_statement_csv(body.csv_text)
    if not rows:
        raise HTTPException(400, "Не удалось разобрать CSV (нужны сумма и опционально дата)")
    result = await match_bank_rows_to_payments(db, project, rows)
    return {"ok": True, "parsed_rows": len(rows), **result}


class BankConfirmIn(BaseModel):
    payment_ids: list[str] = Field(default_factory=list, max_length=100)


@router.post("/{project_id}/import/bank-statement/confirm")
async def confirm_bank_statement_matches(
    project_id: str,
    body: BankConfirmIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """W45: подтвердить matched pending-платежи (те же gate, что PaymentDetailSheet)."""
    from app.services import payment_service as pay_svc
    from app.services import activity_service as act
    from app.services import notification_service as notif

    project = await require_project(db, project_id, user, write=True)
    if not body.payment_ids:
        raise HTTPException(400, "payment_ids_required")

    confirmed: list[str] = []
    blocked: list[str] = []
    for pid in body.payment_ids:
        payment = await pay_svc.confirm_payment(db, pid, project_id=project_id)
        if payment:
            confirmed.append(pid)
            await act.log_event(
                db,
                project_id=project_id,
                user_id=user.id,
                kind="PaymentApproved",
                title=f"Оплата подтверждена (выписка): {payment.title}",
                body=f"{payment.amount} ₽",
                link_path="/(customer)/(tabs)/budget?tab=payments",
                stage_id=payment.stage_id,
            )
            if project.contractor_id and project.contractor_id != user.id:
                await notif.notify(
                    db,
                    user_id=project.contractor_id,
                    project_id=project_id,
                    notification_type="payment_confirmed",
                    title="Оплата подтверждена",
                    body=payment.title,
                    link_path="/(contractor)/(tabs)/budget?tab=payments",
                )
        else:
            blocked.append(pid)
    return {
        "ok": True,
        "confirmed": confirmed,
        "blocked": blocked,
        "confirmed_count": len(confirmed),
        "blocked_count": len(blocked),
    }
