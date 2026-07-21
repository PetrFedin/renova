"""Редактор сметы и учёт расходников (план vs факт)."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.entities import EstimateLine, LineType, Project



def serialize_estimate_lines(lines) -> list[dict]:
    """W68 #39: компактный снимок строк сметы."""
    out = []
    for ln in lines:
        out.append({
            "id": ln.id,
            "name": ln.name,
            "line_type": ln.line_type.value if hasattr(ln.line_type, "value") else str(ln.line_type),
            "unit": ln.unit,
            "quantity_planned": float(ln.quantity_planned or 0),
            "unit_price": float(ln.unit_price or 0),
            "total": round(float(ln.quantity_planned or 0) * float(ln.unit_price or 0), 2),
        })
    return out


def diff_estimate_snapshots(baseline: list[dict], current: list[dict]) -> dict:
    """Сравнение propose-снимка с текущими строками."""
    base_map = {x["id"]: x for x in baseline}
    cur_map = {x["id"]: x for x in current}
    added = [cur_map[i] for i in cur_map if i not in base_map]
    removed = [base_map[i] for i in base_map if i not in cur_map]
    changed = []
    for i in cur_map:
        if i not in base_map:
            continue
        b, c = base_map[i], cur_map[i]
        fields = {}
        for k in ("name", "quantity_planned", "unit_price", "unit"):
            if b.get(k) != c.get(k):
                fields[k] = {"from": b.get(k), "to": c.get(k)}
        if fields:
            changed.append({"id": i, "name": c.get("name"), "fields": fields})
    base_total = round(sum(float(x.get("total") or 0) for x in baseline), 2)
    cur_total = round(sum(float(x.get("total") or 0) for x in current), 2)
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "baseline_total": base_total,
        "current_total": cur_total,
        "delta_total": round(cur_total - base_total, 2),
        "has_changes": bool(added or removed or changed),
    }


async def recalc_budget(db: AsyncSession, project_id: str) -> float:
    """W45: делегирует в sync_project_budget_planned (estimate + approved CO)."""
    from app.services.budget_service import sync_project_budget_planned

    total = await sync_project_budget_planned(db, project_id)
    await db.commit()
    return total


async def update_line(
    db: AsyncSession,
    line_id: str,
    *,
    quantity_planned: float | None = None,
    unit_price: float | None = None,
    quantity_actual: float | None = None,
) -> EstimateLine | None:
    line = await db.get(EstimateLine, line_id)
    if not line:
        return None
    if quantity_planned is not None:
        line.quantity_planned = quantity_planned
    if unit_price is not None:
        line.unit_price = unit_price
    if quantity_actual is not None:
        line.quantity_actual = quantity_actual
    await db.commit()
    await recalc_budget(db, line.project_id)
    await db.refresh(line)
    return line


async def add_line(db: AsyncSession, project_id: str, data: dict) -> EstimateLine:
    line = EstimateLine(
        project_id=project_id,
        line_type=LineType(data["line_type"]),
        name=data["name"],
        unit=data.get("unit", "pcs"),
        quantity_planned=data["quantity_planned"],
        unit_price=data["unit_price"],
        room_name=data.get("room_name"),
    )
    db.add(line)
    await db.commit()
    await recalc_budget(db, project_id)
    await db.refresh(line)
    return line


def material_stats(lines: list[EstimateLine]) -> dict:
    materials = [l for l in lines if l.line_type == LineType.material]
    planned = sum(l.quantity_planned * l.unit_price for l in materials)
    actual = sum((l.quantity_actual or l.quantity_planned) * l.unit_price for l in materials)
    overrun = ((actual - planned) / planned * 100) if planned else 0
    return {"planned": round(planned, 2), "actual": round(actual, 2), "overrun_percent": round(overrun, 1)}



async def get_estimate_lock_diff(db: AsyncSession, project_id: str) -> dict | None:
    """W68 #39: diff снимка propose vs текущие строки."""
    import json as _json
    proj = await db.get(Project, project_id)
    if not proj:
        return None
    result = await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))
    current = serialize_estimate_lines(list(result.scalars().all()))
    baseline: list[dict] = []
    if proj.estimate_propose_snapshot_json:
        try:
            baseline = _json.loads(proj.estimate_propose_snapshot_json)
        except Exception:
            baseline = []
    diff = diff_estimate_snapshots(baseline, current)
    return {
        "proposed_at": proj.estimate_lock_proposed_at.isoformat() if proj.estimate_lock_proposed_at else None,
        "locked_at": proj.estimate_locked_at.isoformat() if proj.estimate_locked_at else None,
        "has_baseline": bool(baseline),
        **diff,
    }


async def propose_estimate_lock(db: AsyncSession, project_id: str, *, proposed_by: str) -> tuple[Project | None, dict]:
    """W57: исполнитель предлагает фиксацию — без estimate_locked_at."""
    from datetime import datetime, timedelta
    from app.services import notification_service as notif_svc

    PROPOSE_TTL_DAYS = 14  # W66 #26

    proj = await db.get(Project, project_id)
    if not proj:
        return None, {"code": "not_found"}
    if proj.estimate_locked_at:
        return proj, {"code": "already_locked", "locked_at": proj.estimate_locked_at.isoformat()}
    result = await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))
    lines = list(result.scalars().all())
    if not lines:
        return None, {"code": "empty_estimate", "message": "Добавьте строки в смету перед фиксацией"}
    # Повторный propose всегда обновляет TTL и шлёт напоминание
    proj.estimate_lock_proposed_at = datetime.utcnow()
    proj.estimate_lock_proposed_by = proposed_by
    import json as _json
    proj.estimate_propose_snapshot_json = _json.dumps(serialize_estimate_lines(lines), ensure_ascii=False)
    if proj.customer_id and proposed_by != proj.customer_id:
        await notif_svc.notify(
            db,
            user_id=proj.customer_id,
            project_id=project_id,
            notification_type="approval",
            title="Смета на согласование",
            body=f"Исполнитель отправил смету на фиксацию (действует {PROPOSE_TTL_DAYS} дн.). Проверьте и согласуйте.",
            link_path="/(customer)/(tabs)/object?tab=estimate",
            return_to="/(customer)/(tabs)/home",
        )
    await db.commit()
    await db.refresh(proj)
    return proj, {"code": "proposed", "proposed_at": proj.estimate_lock_proposed_at.isoformat()}


async def lock_estimate(db: AsyncSession, project_id: str, *, locked_by: str) -> tuple[Project | None, dict]:
    """W57: только заказчик финализирует lock (estimate_locked_at + договор)."""
    from datetime import datetime
    from app.services import project_document_service as docs_svc
    from app.services import notification_service as notif_svc

    proj = await db.get(Project, project_id)
    if not proj:
        return None, {"code": "not_found"}
    if proj.estimate_locked_at:
        return proj, {"code": "already_locked", "locked_at": proj.estimate_locked_at.isoformat()}
    result = await db.execute(select(EstimateLine).where(EstimateLine.project_id == project_id))
    lines = list(result.scalars().all())
    if not lines:
        return None, {"code": "empty_estimate", "message": "Добавьте строки в смету перед фиксацией"}
    # Только customer_id может финализировать
    if locked_by != proj.customer_id:
        return proj, {"code": "customer_lock_required", "message": "Фиксацию подтверждает заказчик"}
    # W64: при назначенном исполнителе сначала propose-lock, иначе unilateral
    if proj.contractor_id and not proj.estimate_lock_proposed_at:
        return proj, {
            "code": "proposal_required",
            "message": "Сначала исполнитель должен отправить смету на согласование",
        }
    # W66 #26: просроченный propose — нужна повторная отправка
    if proj.contractor_id and proj.estimate_lock_proposed_at:
        from datetime import timedelta
        age = datetime.utcnow() - proj.estimate_lock_proposed_at
        if age > timedelta(days=14):
            return proj, {
                "code": "proposal_stale",
                "message": "Предложение сметы устарело (>14 дн.). Исполнитель должен отправить снова.",
            }
    proj.estimate_locked_at = datetime.utcnow()
    proj.estimate_lock_proposed_at = None
    proj.estimate_lock_proposed_by = None
    proj.estimate_propose_snapshot_json = None
    proj.estimate_propose_snapshot_json = None
    await recalc_budget(db, project_id)
    draft = await docs_svc.ensure_contract_draft(db, project_id=project_id, created_by=locked_by)
    titles = ", ".join(draft.get("pending_titles") or [])
    if proj.contractor_id:
        await notif_svc.notify(
            db,
            user_id=proj.contractor_id,
            project_id=project_id,
            notification_type="document",
            title="Заказчик согласовал смету",
            body=titles or "Базовая смета зафиксирована. Можно запускать этапы и договор.",
            link_path="/documents",
            return_to="/(contractor)/(tabs)/object",
        )
    await db.commit()
    await db.refresh(proj)
    return proj, {"code": "locked", "contract": draft}


async def clear_estimate_proposal(
    db: AsyncSession,
    project_id: str,
    *,
    cleared_by: str,
    reason: str | None = None,
    mode: str = "reject",
) -> tuple[Project | None, dict]:
    """W65: снять propose — reject (заказчик) или withdraw (исполнитель)."""
    from app.services import notification_service as notif_svc

    proj = await db.get(Project, project_id)
    if not proj:
        return None, {"code": "not_found"}
    if proj.estimate_locked_at:
        return proj, {"code": "already_locked", "locked_at": proj.estimate_locked_at.isoformat()}
    if not proj.estimate_lock_proposed_at:
        return proj, {"code": "no_proposal"}

    if mode == "reject":
        if cleared_by != proj.customer_id:
            return proj, {"code": "customer_reject_required", "message": "Отклонить предложение может заказчик"}
    elif mode == "withdraw":
        if cleared_by != proj.contractor_id:
            return proj, {"code": "contractor_withdraw_required", "message": "Отозвать предложение может исполнитель"}
    else:
        return proj, {"code": "invalid_mode"}

    proj.estimate_lock_proposed_at = None
    proj.estimate_lock_proposed_by = None
    proj.estimate_propose_snapshot_json = None
    body = (reason or "").strip() or (
        "Заказчик отклонил фиксацию сметы — нужна правка."
        if mode == "reject"
        else "Исполнитель отозвал предложение фиксации."
    )
    notify_uid = proj.contractor_id if mode == "reject" else proj.customer_id
    if notify_uid and notify_uid != cleared_by:
        await notif_svc.notify(
            db,
            user_id=notify_uid,
            project_id=project_id,
            notification_type="approval",
            title="Смета: предложение снято" if mode == "withdraw" else "Смета: нужна правка",
            body=body,
            link_path="/(contractor)/(tabs)/object?tab=estimate" if mode == "reject" else "/(customer)/(tabs)/object?tab=estimate",
            return_to="/(contractor)/(tabs)/home" if mode == "reject" else "/(customer)/(tabs)/home",
        )
    await db.commit()
    await db.refresh(proj)
    return proj, {"code": "cleared", "mode": mode}






async def import_estimate_csv(db: AsyncSession, project_id: str, csv_text: str) -> dict:
    """W71/W73: импорт сметы CSV/TSV/; — Excel + ГрандСмета-подобные выгрузки.

    Разделитель определяется автоматически (, ; tab).
    Заголовки: name/наименование/работы, qty/количество, price/цена,
    unit/ед; если есть сумма без цены → цена = сумма/кол-во.
    """
    import csv
    import io
    import re as _re

    text = (csv_text or "").strip().lstrip("\ufeff")
    if not text:
        raise ValueError("empty_csv")

    sample = text[:4096]
    semi, comma, tab = sample.count(";"), sample.count(","), sample.count("\t")
    delimiter = ";" if semi >= comma and semi >= tab and semi > 0 else ("\t" if tab > comma else ",")

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if not reader.fieldnames:
        raise ValueError("csv_no_header")

    def norm(h: str) -> str:
        h = (h or "").strip().lower().replace("ё", "е")
        h = _re.sub(r"[\s.]+", "_", h)
        h = _re.sub(r"_+", "_", h).strip("_")
        return h

    field_map = {norm(h): h for h in reader.fieldnames if h is not None}

    def cell(row: dict, *keys: str) -> str:
        for k in keys:
            nk = norm(k)
            src = field_map.get(nk)
            if src and row.get(src) not in (None, ""):
                return str(row.get(src)).strip()
        return ""

    def parse_num(raw: str) -> float:
        s = (raw or "").strip().replace(" ", "").replace("\u00a0", "").replace(",", ".")
        if not s:
            return 0.0
        return float(s)

    created = 0
    skipped = 0
    errors: list[str] = []
    for i, row in enumerate(reader, start=2):
        name = cell(
            row,
            "name", "название", "наименование", "наименование_работ", "работы",
            "title", "наименование_позиции",
        )
        if not name or name.isdigit() or name.lower() in ("итого", "всего"):
            skipped += 1
            continue
        lt_raw = cell(row, "line_type", "type", "тип", "раздел") or "work"
        lt = "material" if lt_raw.lower() in ("material", "материал", "mat", "материалы") else "work"
        unit = cell(row, "unit", "ед", "ед_изм", "единица", "единица_измерения") or "pcs"
        try:
            qty = parse_num(
                cell(row, "quantity_planned", "qty", "количество", "кол-во", "кол", "quantity", "кол_во") or "1"
            )
            price_raw = cell(row, "unit_price", "price", "цена", "price_unit", "цена_ед", "цена_за_ед")
            total_raw = cell(row, "sum", "сумма", "стоимость", "total", "amount")
            if price_raw:
                price = parse_num(price_raw)
            elif total_raw and qty:
                price = parse_num(total_raw) / qty
            else:
                price = 0.0
        except ValueError:
            errors.append(f"строка {i}: число qty/price")
            skipped += 1
            continue
        if qty <= 0:
            skipped += 1
            continue
        room = cell(row, "room_name", "room", "комната", "помещение") or None
        line = EstimateLine(
            project_id=project_id,
            line_type=LineType(lt),
            name=name[:200],
            unit=unit[:32],
            quantity_planned=qty,
            unit_price=max(0.0, price),
            room_name=room[:100] if room else None,
        )
        db.add(line)
        created += 1

    if created:
        await db.flush()
        await sync_after_import(db, project_id)
    await db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "errors": errors[:10],
        "delimiter": "tab" if delimiter == "\t" else delimiter,
    }


async def sync_after_import(db: AsyncSession, project_id: str) -> None:
    from app.services.budget_service import sync_project_budget_planned

    await sync_project_budget_planned(db, project_id)
