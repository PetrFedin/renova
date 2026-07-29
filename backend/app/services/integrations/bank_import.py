"""Импорт банковской выписки CSV → матч к pending/confirmed payments (P4.1b)."""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from difflib import SequenceMatcher

_AMOUNT_RE = re.compile(r"-?\d+[.,]?\d*")


def _parse_amount(raw: str) -> float | None:
    s = (raw or "").strip().replace(" ", "").replace("\u00a0", "")
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    m = _AMOUNT_RE.search(s)
    if not m:
        return None
    try:
        return abs(float(m.group(0)))
    except ValueError:
        return None


def _parse_date(raw: str) -> datetime | None:
    s = (raw or "").strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y.%m.%d"):
        try:
            return datetime.strptime(s[:10], fmt)
        except ValueError:
            continue
    return None


def parse_bank_statement_csv(text: str) -> list[dict]:
    """Парсит CSV (; или ,). Ищет колонки дата/сумма/назначение по заголовку или позиции."""
    raw = text.lstrip("\ufeff").strip()
    if not raw:
        return []
    sample = raw[:2048]
    delim = ";" if sample.count(";") >= sample.count(",") else ","
    reader = csv.reader(io.StringIO(raw), delimiter=delim)
    rows = list(reader)
    if not rows:
        return []

    header = [c.strip().lower() for c in rows[0]]
    date_i = amount_i = desc_i = None
    for i, h in enumerate(header):
        if date_i is None and any(k in h for k in ("дата", "date", "день")):
            date_i = i
        if amount_i is None and any(k in h for k in ("сумма", "amount", "sum", "оборот")):
            amount_i = i
        if desc_i is None and any(k in h for k in ("назнач", "описан", "desc", "purpose", "платеж")):
            desc_i = i

    start = 1
    if date_i is None and amount_i is None:
        date_i, amount_i, desc_i = 0, 1, 2
        start = 0

    out: list[dict] = []
    for row in rows[start:]:
        if not row or all(not (c or "").strip() for c in row):
            continue

        def cell(i: int | None) -> str:
            if i is None or i >= len(row):
                return ""
            return (row[i] or "").strip()

        amount = _parse_amount(cell(amount_i))
        if amount is None or amount <= 0:
            continue
        dt = _parse_date(cell(date_i))
        out.append(
            {
                "date": dt.date().isoformat() if dt else None,
                "amount": round(amount, 2),
                "description": cell(desc_i)[:300],
            }
        )
    return out


async def match_bank_rows_to_payments(
    db,
    project,
    rows: list[dict],
    *,
    amount_tol: float = 1.0,
    day_window: int = 3,
) -> dict:
    """
    Матчит строки выписки к платежам проекта.

    В пределах окна дата участвует в confidence score. За пределами окна exact-amount
    матч допускается только при единственном кандидате; несколько одинаковых сумм
    остаются unmatched, чтобы не подтвердить не тот платёж.
    """
    from sqlalchemy import select
    from app.models.entities import Payment, PaymentStatus

    payments = list(
        (
            await db.execute(select(Payment).where(Payment.project_id == project.id))
        ).scalars().all()
    )
    used: set[str] = set()
    matches: list[dict] = []
    unmatched_rows: list[dict] = []

    for row in rows:
        row_date = None
        if row.get("date"):
            try:
                row_date = datetime.strptime(row["date"], "%Y-%m-%d").date()
            except ValueError:
                row_date = None

        description = (row.get("description") or "").lower()
        candidates: list[dict] = []
        for payment in payments:
            if payment.id in used:
                continue
            if abs(float(payment.amount) - float(row["amount"])) > amount_tol:
                continue

            payment_date = (
                (payment.confirmed_at or payment.created_at).date()
                if (payment.confirmed_at or payment.created_at)
                else None
            )
            date_match: bool | None = None
            score = 1.0
            if row_date and payment_date:
                delta = abs((row_date - payment_date).days)
                date_match = delta <= day_window
                if date_match:
                    score += max(0.0, (day_window - delta) / max(day_window, 1))
                else:
                    score -= min(0.5, (delta - day_window) / max(day_window, 1) * 0.1)

            title = (payment.title or "").lower()
            description_score = SequenceMatcher(None, description, title).ratio() if description and title else 0.0
            score += description_score
            candidates.append(
                {
                    "payment": payment,
                    "score": score,
                    "date_match": date_match,
                    "description_score": description_score,
                }
            )

        dated_candidates = [candidate for candidate in candidates if candidate["date_match"] is not False]
        selected = None
        match_basis = None
        if dated_candidates:
            selected = max(dated_candidates, key=lambda candidate: candidate["score"])
            match_basis = "amount_date_description" if selected["date_match"] is True else "amount_description"
        elif len(candidates) == 1:
            selected = candidates[0]
            match_basis = "unique_amount"

        if selected:
            payment = selected["payment"]
            used.add(payment.id)
            status = payment.status.value if hasattr(payment.status, "value") else str(payment.status)
            matches.append(
                {
                    "row": row,
                    "payment_id": payment.id,
                    "payment_title": payment.title,
                    "payment_status": status,
                    "payment_amount": payment.amount,
                    "score": round(float(selected["score"]), 3),
                    "date_match": selected["date_match"],
                    "match_basis": match_basis,
                }
            )
        else:
            unmatched_rows.append(row)

    unmatched_payments = [
        {
            "id": payment.id,
            "title": payment.title,
            "amount": payment.amount,
            "status": payment.status.value if hasattr(payment.status, "value") else str(payment.status),
        }
        for payment in payments
        if payment.id not in used and payment.status == PaymentStatus.pending
    ]
    return {
        "matched": len(matches),
        "unmatched_rows": len(unmatched_rows),
        "unmatched_pending_payments": len(unmatched_payments),
        "matches": matches,
        "unmatched_statement_rows": unmatched_rows[:50],
        "unmatched_pending": unmatched_payments[:50],
    }


async def create_expenses_from_unmatched(
    db,
    *,
    project_id: str,
    unmatched_rows: list[dict],
    limit: int = 50,
) -> dict:
    """W74: несматченные строки выписки → Expense + refresh budget facts."""
    from app.services import budget_service as bud

    created: list[str] = []
    for row in unmatched_rows[:limit]:
        amount = float(row.get("amount") or 0)
        if amount == 0:
            continue
        exp_date = None
        if row.get("date"):
            try:
                exp_date = datetime.strptime(row["date"], "%Y-%m-%d")
            except ValueError:
                exp_date = None
        title = (row.get("description") or f"Банк {amount:.0f} ₽")[:255]
        exp = await bud.expense_from_bank_row(
            db,
            project_id=project_id,
            amount=amount,
            title=title,
            expense_date=exp_date,
            comment="bank_statement_unmatched",
        )
        created.append(exp.id)
    if created:
        await bud.refresh_budget_facts(db, project_id)
        await db.commit()
    return {"expenses_created": len(created), "expense_ids": created[:20]}
