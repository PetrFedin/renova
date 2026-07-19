"""Импорт банковской выписки CSV → матч к pending/confirmed payments (P4.1b)."""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timedelta
from difflib import SequenceMatcher

_AMOUNT_RE = re.compile(r"-?\d+[.,]?\d*")


def _parse_amount(raw: str) -> float | None:
    s = (raw or "").strip().replace(" ", "").replace("\u00a0", "")
    if not s:
        return None
    # 1 500,50 or 1500.50
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
        # без заголовка: date;amount;desc
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
    """Матчит строки выписки к платежам проекта по сумме (±tol) и дате (±window)."""
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
        best = None
        best_score = 0.0
        row_date = None
        if row.get("date"):
            try:
                row_date = datetime.strptime(row["date"], "%Y-%m-%d").date()
            except ValueError:
                row_date = None
        for p in payments:
            if p.id in used:
                continue
            if abs(float(p.amount) - float(row["amount"])) > amount_tol:
                continue
            score = 1.0
            p_date = (p.confirmed_at or p.created_at).date() if (p.confirmed_at or p.created_at) else None
            if row_date and p_date:
                delta = abs((row_date - p_date).days)
                if delta > day_window:
                    continue
                score += max(0.0, (day_window - delta) / day_window)
            desc = (row.get("description") or "").lower()
            title = (p.title or "").lower()
            if desc and title:
                score += SequenceMatcher(None, desc, title).ratio()
            if score > best_score:
                best_score = score
                best = p
        if best:
            used.add(best.id)
            st = best.status.value if hasattr(best.status, "value") else str(best.status)
            matches.append(
                {
                    "row": row,
                    "payment_id": best.id,
                    "payment_title": best.title,
                    "payment_status": st,
                    "payment_amount": best.amount,
                    "score": round(best_score, 3),
                }
            )
        else:
            unmatched_rows.append(row)

    unmatched_payments = [
        {
            "id": p.id,
            "title": p.title,
            "amount": p.amount,
            "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        }
        for p in payments
        if p.id not in used and p.status == PaymentStatus.pending
    ]
    return {
        "matched": len(matches),
        "unmatched_rows": len(unmatched_rows),
        "unmatched_pending_payments": len(unmatched_payments),
        "matches": matches,
        "unmatched_statement_rows": unmatched_rows[:50],
        "unmatched_pending": unmatched_payments[:50],
    }
