"""Dev SQLite: добавляет колонки/таблицы OS без полного Alembic."""
import sqlite3
from pathlib import Path

from app.core.config import settings


def _sqlite_path() -> Path | None:
    url = settings.database_url
    if not url.startswith("sqlite"):
        return None
    if ":///" in url:
        raw = url.split("///", 1)[1]
        p = Path(raw)
        if not p.is_absolute():
            p = Path(__file__).resolve().parents[2] / p
        return p
    return None


def ensure_os_schema() -> None:
    path = _sqlite_path()
    if not path or not path.exists():
        return
    conn = sqlite3.connect(path)
    c = conn.cursor()

    def cols(table: str) -> set[str]:
        return {r[1] for r in c.execute(f"PRAGMA table_info({table})").fetchall()}

    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

    if "purchases" not in tables:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS suppliers (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
              category TEXT, phone TEXT, site TEXT, created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS purchases (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, supplier_id TEXT,
              supplier_name TEXT, status TEXT DEFAULT 'draft', total_amount REAL DEFAULT 0,
              ordered_at TEXT, paid_at TEXT, delivered_at TEXT, receipt_id TEXT,
              notes TEXT, created_at TEXT, updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS purchase_items (
              id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL, material_pick_id TEXT,
              name TEXT NOT NULL, qty REAL DEFAULT 1, unit TEXT DEFAULT 'шт',
              unit_price REAL DEFAULT 0, room_id TEXT, stage_id TEXT
            );
            """
        )


    if "receipts" in tables:
        rc = cols("receipts")
        if "payment_id" not in rc:
            try:
                c.execute("ALTER TABLE receipts ADD COLUMN payment_id TEXT")
            except Exception:
                pass

    if "material_picks" in tables:
        mp = cols("material_picks")
        for col, typ in [
            ("category", "TEXT"),
            ("qty_needed", "REAL"),
            ("qty_delivered", "REAL DEFAULT 0"),
            ("stage_id", "TEXT"),
        ]:
            if col not in mp:
                c.execute(f"ALTER TABLE material_picks ADD COLUMN {col} {typ}")

    if "project_issues" not in tables:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS project_issues (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, room_id TEXT, stage_id TEXT,
              title TEXT NOT NULL, description TEXT, severity TEXT DEFAULT 'medium',
              status TEXT DEFAULT 'open', assignee_id TEXT, due_at TEXT, created_at TEXT, closed_at TEXT
            );
            """
        )
    if "stages" in tables:
        st = cols("stages") if "stages" in tables else set()
        if "checklist_json" not in st:
            try:
                c.execute("ALTER TABLE stages ADD COLUMN checklist_json TEXT")
            except Exception:
                pass


    if "work_dependencies" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS work_dependencies (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, stage_id TEXT NOT NULL,
              depends_on_stage_id TEXT, depends_on_material_pick_id TEXT,
              dependency_type TEXT DEFAULT 'work', criticality TEXT DEFAULT 'high',
              status TEXT DEFAULT 'pending', created_at TEXT
            );
        """)

    if "project_work_schedules" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS project_work_schedules (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'draft',
              title TEXT DEFAULT 'План-график работ',
              description TEXT,
              planned_start_date TEXT,
              planned_finish_date TEXT,
              rejection_reason TEXT,
              created_by TEXT NOT NULL,
              submitted_by TEXT,
              confirmed_by TEXT,
              rejected_by TEXT,
              created_at TEXT,
              submitted_at TEXT,
              confirmed_at TEXT,
              rejected_at TEXT,
              updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_project_work_schedules_project_id ON project_work_schedules(project_id);
            CREATE INDEX IF NOT EXISTS ix_project_work_schedules_status ON project_work_schedules(status);
        """)

    if "project_work_schedule_items" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS project_work_schedule_items (
              id TEXT PRIMARY KEY,
              schedule_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              stage_id TEXT,
              title TEXT NOT NULL,
              description TEXT,
              status TEXT NOT NULL DEFAULT 'planned',
              planned_start_date TEXT NOT NULL,
              planned_finish_date TEXT NOT NULL,
              actual_start_date TEXT,
              actual_finish_date TEXT,
              depends_on_item_id TEXT,
              requires_customer_acceptance INTEGER DEFAULT 1,
              requires_photo INTEGER DEFAULT 1,
              requires_hidden_work_acceptance INTEGER DEFAULT 0,
              delay_days INTEGER DEFAULT 0,
              blocking_reason TEXT,
              sort_order INTEGER DEFAULT 0,
              progress_percent REAL DEFAULT 0,
              created_at TEXT,
              updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_project_work_schedule_items_schedule_id ON project_work_schedule_items(schedule_id);
            CREATE INDEX IF NOT EXISTS ix_project_work_schedule_items_project_id ON project_work_schedule_items(project_id);
            CREATE INDEX IF NOT EXISTS ix_project_work_schedule_items_stage_id ON project_work_schedule_items(stage_id);
            CREATE INDEX IF NOT EXISTS ix_project_work_schedule_items_status ON project_work_schedule_items(status);
        """)

    if "property_floors" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS property_floors (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
              floor_number INTEGER DEFAULT 1, area_sqm REAL, notes TEXT, created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS property_objects (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, object_type TEXT,
              total_area_sqm REAL, floors_count INTEGER DEFAULT 1, rooms_count INTEGER,
              ceiling_height_m REAL, build_year INTEGER, building_type TEXT,
              has_elevator INTEGER DEFAULT 0, condition_before TEXT, is_new_build INTEGER DEFAULT 0,
              has_demolition INTEGER DEFAULT 0, has_replanning INTEGER DEFAULT 0,
              has_design_project INTEGER DEFAULT 0, has_contractor INTEGER DEFAULT 0,
              notes TEXT, created_at TEXT
            );
        """)

    if "projects" in tables:
        pc = {r[1] for r in c.execute("PRAGMA table_info(projects)").fetchall()}
        if "foreman_id" not in pc:
            try: c.execute("ALTER TABLE projects ADD COLUMN foreman_id TEXT")
            except Exception: pass
    if "rooms" in tables:
        rc = {r[1] for r in c.execute("PRAGMA table_info(rooms)").fetchall()}
        if "floor_id" not in rc:
            try: c.execute("ALTER TABLE rooms ADD COLUMN floor_id TEXT")
            except Exception: pass
        if "is_archived" not in rc:
            try: c.execute("ALTER TABLE rooms ADD COLUMN is_archived INTEGER DEFAULT 0")
            except Exception: pass


    if "work_acceptances" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS work_acceptances (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, room_id TEXT,
                stage_id TEXT NOT NULL, requested_by TEXT, accepted_by TEXT,
                requested_at TEXT, accepted_at TEXT, status TEXT DEFAULT 'not_requested',
                checklist_json TEXT, quality_score REAL, comment TEXT, created_at TEXT
            );
        """)
    if "budget_lines" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS budget_lines (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, room_id TEXT, stage_id TEXT,
                estimate_line_id TEXT, category TEXT DEFAULT 'other', description TEXT,
                planned_amount REAL DEFAULT 0, actual_amount REAL DEFAULT 0,
                expense_type TEXT DEFAULT 'materials', status TEXT DEFAULT 'active', created_at TEXT
            );
        """)
    if "expenses" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, room_id TEXT, stage_id TEXT,
                material_pick_id TEXT, receipt_id TEXT, payment_id TEXT, purchase_id TEXT,
                title TEXT, category TEXT DEFAULT 'materials', amount REAL,
                currency TEXT DEFAULT 'RUB', payment_method TEXT, supplier_name TEXT,
                comment TEXT, status TEXT DEFAULT 'confirmed', expense_date TEXT, created_at TEXT
            );
        """)

    # Renova OS: поля работ (исполнитель, фактические даты)
    if "stages" in tables:
        st = cols("stages")
        for col, ddl in [
            ("assignee_id", "ALTER TABLE stages ADD COLUMN assignee_id TEXT"),
            ("actual_start", "ALTER TABLE stages ADD COLUMN actual_start TEXT"),
            ("actual_end", "ALTER TABLE stages ADD COLUMN actual_end TEXT"),
            ("weight_coefficient", "ALTER TABLE stages ADD COLUMN weight_coefficient REAL DEFAULT 0"),
        ]:
            if col not in st:
                try:
                    c.execute(ddl)
                except Exception:
                    pass


    # Удалить дубликаты Expense на один receipt_id (ломали POST /receipts/*)
    try:
        c.execute("""
            DELETE FROM expenses WHERE id NOT IN (
              SELECT MIN(id) FROM expenses WHERE receipt_id IS NOT NULL GROUP BY receipt_id
            ) AND receipt_id IS NOT NULL
        """)
        conn.commit()
    except Exception:
        pass


    # Очистка «сирот» и E2E-мусора — завышенный budget_spent (164k+)
    try:
        c.execute("""
            DELETE FROM expenses WHERE receipt_id IS NULL AND payment_id IS NULL
            AND (purchase_id IS NULL OR purchase_id = '')
            AND (material_pick_id IS NULL OR material_pick_id = '')
            AND title LIKE 'Чек %%' AND status IN ('confirmed', 'pending_receipt')
        """)
        c.execute("""
            DELETE FROM receipts WHERE id NOT IN (
              SELECT MAX(id) FROM receipts
              WHERE fn = 'MANUAL' AND (
                qr_raw LIKE '%%E2E%%' OR qr_raw LIKE '%%Walkthrough%%' OR qr_raw LIKE '%%test%%'
              )
              GROUP BY project_id, amount, qr_raw
            ) AND fn = 'MANUAL' AND (
              qr_raw LIKE '%%E2E%%' OR qr_raw LIKE '%%Walkthrough%%' OR qr_raw LIKE '%%test%%'
            )
        """)
        c.execute("""
            DELETE FROM expenses WHERE receipt_id IS NOT NULL
            AND receipt_id NOT IN (SELECT id FROM receipts)
        """)
        c.execute("""
            DELETE FROM expenses WHERE title LIKE '%E2E manual%' OR title LIKE 'Walkthrough%'
        """)
        try:
            c.execute("""
                DELETE FROM chat_threads WHERE title LIKE 'Walkthrough%' OR title LIKE 'E2E%'
            """)
        except Exception:
            pass
        c.execute("""
            DELETE FROM expenses WHERE project_id IN (
              SELECT id FROM projects WHERE name LIKE 'Wizard Test%'
            )
        """)
        c.execute("""
            DELETE FROM receipts WHERE project_id IN (
              SELECT id FROM projects WHERE name LIKE 'Wizard Test%'
            )
        """)
        try:
            c.execute("DELETE FROM projects WHERE name LIKE 'Wizard Test%'")
        except Exception:
            pass
        c.execute("""
            UPDATE projects SET budget_spent = COALESCE((
              SELECT ROUND(SUM(amount), 2) FROM expenses
              WHERE expenses.project_id = projects.id AND status = 'confirmed'
            ), 0)
        """)
        conn.commit()
    except Exception:
        pass

    # Миграция: только 2 роли — заказчик / исполнитель
    try:
        c.execute("UPDATE users SET role='customer' WHERE role IN ('viewer','foreman')")
    except Exception:
        pass


    # Chat enhancements
    if "chat_thread_reads" in tables:
        ctr = cols("chat_thread_reads")
        for col, typ in [("is_archived", "INTEGER DEFAULT 0"), ("is_pinned", "INTEGER DEFAULT 0"), ("pinned_at", "TEXT")]:
            if col not in ctr:
                try: c.execute(f"ALTER TABLE chat_thread_reads ADD COLUMN {col} {typ}")
                except Exception: pass
    if "chat_messages" in tables:
        cm = cols("chat_messages")
        for col, typ in [("is_pinned", "INTEGER DEFAULT 0"), ("reply_to_id", "TEXT"), ("meta_json", "TEXT")]:
            if col not in cm:
                try: c.execute(f"ALTER TABLE chat_messages ADD COLUMN {col} {typ}")
                except Exception: pass
    if "users" in tables:
        uc = cols("users")
        if "profile_code" not in uc:
            try: c.execute("ALTER TABLE users ADD COLUMN profile_code TEXT")
            except Exception: pass
    if "scratchpad_lines" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS scratchpad_lines (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL,
              text TEXT NOT NULL,
              line_kind TEXT DEFAULT 'note',
              done INTEGER DEFAULT 0,
              promoted_kind TEXT,
              promoted_id TEXT,
              sort_order INTEGER DEFAULT 0,
              created_by TEXT,
              created_at TEXT,
              updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_scratchpad_lines_project ON scratchpad_lines(project_id);
        """)

    if "chat_thread_participants" not in tables:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS chat_thread_participants (
              id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, user_id TEXT,
              phone TEXT, profile_code TEXT, invited_by TEXT NOT NULL,
              status TEXT DEFAULT 'pending', created_at TEXT
            );
        """)

    conn.commit()
    conn.close()
