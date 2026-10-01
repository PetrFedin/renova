"""Schema drift report: SQLAlchemy models vs. a database built by ``alembic upgrade head`` (APIB-039).

Usage (from ``backend/``)::

    # self-contained: creates a scratch database on the server given by ADMIN_URL,
    # runs ``alembic upgrade head`` into it, compares, drops it again
    .venv/bin/python -m scripts.schema_drift_report \
        --admin-url postgresql://renova:renova@127.0.0.1:5433/postgres [--markdown out.md] [--json]

    # compare an already migrated, disposable database
    .venv/bin/python -m scripts.schema_drift_report --database-url postgresql://.../drift_check

The script never touches the ``renova`` database; with ``--admin-url`` it creates and
drops only ``drift_check_<random>``.  Exit code is 0 unless ``--check`` is passed and the
number of differences exceeds ``schema_drift_baseline.json`` (ratchet).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
BASELINE_FILE = Path(__file__).with_name("schema_drift_baseline.json")


def _async_url(url: str) -> str:
    return re.sub(r"^postgresql(\+\w+)?://", "postgresql+asyncpg://", url)


def _flatten(diffs: list[Any]) -> list[tuple]:
    out: list[tuple] = []
    for d in diffs:
        if isinstance(d, list):  # modify_* ops come as a list of tuples for one column
            out.extend(d)
        else:
            out.append(d)
    return out


def describe(diff: tuple) -> dict[str, str]:
    """Turn one alembic diff tuple into {kind, object, detail}."""
    op = diff[0]
    if op == "add_table":
        return {"kind": "table missing in DB", "object": diff[1].name, "detail": "model table absent from migrated schema"}
    if op == "remove_table":
        return {"kind": "table only in DB", "object": diff[1].name, "detail": "migrated table has no model"}
    if op == "add_column":
        return {"kind": "column missing in DB", "object": f"{diff[2]}.{diff[3].name}", "detail": str(diff[3].type)}
    if op == "remove_column":
        return {"kind": "column only in DB", "object": f"{diff[2]}.{diff[3].name}", "detail": str(diff[3].type)}
    if op == "modify_nullable":
        _, _schema, table, column, _kw, existing, model = diff
        return {"kind": "nullable", "object": f"{table}.{column}", "detail": f"DB nullable={existing}, model nullable={model}"}
    if op == "modify_type":
        _, _schema, table, column, _kw, existing, model = diff
        return {"kind": "column type", "object": f"{table}.{column}", "detail": f"DB {existing} -> model {model}"}
    if op == "modify_default":
        _, _schema, table, column, _kw, existing, model = diff
        return {"kind": "server default", "object": f"{table}.{column}", "detail": f"DB {existing!r} -> model {model!r}"}
    if op == "modify_comment":
        return {"kind": "comment", "object": f"{diff[2]}.{diff[3]}", "detail": ""}
    if op in {"add_index", "remove_index"}:
        idx = diff[1]
        where = "model only" if op == "add_index" else "DB only"
        kind = "index missing in DB" if op == "add_index" else "index only in DB"
        return {"kind": kind, "object": f"{idx.table.name}.{idx.name}", "detail": f"{where}; columns={[c.name for c in idx.columns]} unique={idx.unique}"}
    if op in {"add_constraint", "remove_constraint"}:
        con = diff[1]
        name = getattr(con, "name", None) or type(con).__name__
        table = getattr(getattr(con, "table", None), "name", "?")
        cols = [c.name for c in getattr(con, "columns", [])] if hasattr(con, "columns") else []
        kind_name = type(con).__name__
        kind = "constraint missing in DB" if op == "add_constraint" else "constraint only in DB"
        return {"kind": kind, "object": f"{table}.{name}", "detail": f"{kind_name} columns={cols}"}
    if op in {"add_fk", "remove_fk"}:
        fk = diff[1]
        table = getattr(getattr(fk, "parent", None), "name", None) or getattr(fk, "source", "?")
        cols = [e.parent.name for e in fk.elements] if hasattr(fk, "elements") else list(getattr(fk, "constrained_columns", []))
        kind = "foreign key missing in DB" if op == "add_fk" else "foreign key only in DB"
        return {"kind": kind, "object": f"{table}.{'/'.join(cols)}", "detail": ""}
    return {"kind": f"other:{op}", "object": str(diff[1:2]), "detail": ""}


def compare(url: str, *, server_defaults: bool = False) -> list[dict[str, str]]:
    import asyncio

    import sqlalchemy as sa
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy.ext.asyncio import create_async_engine

    sys.path.insert(0, str(BACKEND))
    from app.db.base import Base
    import app.models  # noqa: F401
    import app.models.project_documents  # noqa: F401
    import app.models.webhook_runtime  # noqa: F401

    def _diff(sync_conn):
        ctx = MigrationContext.configure(sync_conn, opts={"compare_type": True, "compare_server_default": server_defaults})
        return compare_metadata(ctx, Base.metadata)

    async def _run():
        engine = create_async_engine(_async_url(url))
        try:
            async with engine.connect() as conn:
                return await conn.run_sync(_diff)
        finally:
            await engine.dispose()

    rows = [describe(d) for d in _flatten(asyncio.run(_run()))]
    return [r for r in rows if r["object"] != "alembic_version"]


def _psql_admin(admin_url: str, statement: str) -> None:
    import asyncio

    import sqlalchemy as sa
    from sqlalchemy.ext.asyncio import create_async_engine

    async def _run():
        engine = create_async_engine(_async_url(admin_url), isolation_level="AUTOCOMMIT")
        try:
            async with engine.connect() as conn:
                await conn.execute(sa.text(statement))
        finally:
            await engine.dispose()

    asyncio.run(_run())


def _with_database(url: str, name: str) -> str:
    return re.sub(r"/[^/?]*(\?|$)", f"/{name}\\1", url, count=1)


def run_on_scratch(admin_url: str, *, server_defaults: bool = False) -> list[dict[str, str]]:
    name = f"drift_check_{uuid.uuid4().hex[:8]}"
    assert name != "renova"
    _psql_admin(admin_url, f'create database "{name}"')
    try:
        target = _with_database(admin_url, name)
        env = {**os.environ, "DATABASE_URL": _async_url(target), "ENVIRONMENT": "development", "ALLOW_CREATE_ALL": "false"}
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True, capture_output=True)
        return compare(target, server_defaults=server_defaults)
    finally:
        _psql_admin(admin_url, f'drop database if exists "{name}" with (force)')


def summarize(rows: list[dict[str, str]]) -> dict[str, Any]:
    kinds = Counter(r["kind"] for r in rows)
    return {"total": len(rows), "by_kind": dict(sorted(kinds.items()))}


def load_baseline() -> dict[str, Any]:
    return json.loads(BASELINE_FILE.read_text(encoding="utf-8"))


def markdown(rows: list[dict[str, str]]) -> str:
    summary = summarize(rows)
    lines = [f"Total differences: **{summary['total']}**", "", "| kind | count |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in summary["by_kind"].items()]
    lines += ["", "| # | kind | object | detail |", "|---|---|---|---|"]
    for i, r in enumerate(sorted(rows, key=lambda r: (r["kind"], r["object"])), 1):
        lines.append(f"| {i} | {r['kind']} | `{r['object']}` | {r['detail'].replace('|', '/')} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--admin-url", help="server URL used to create/drop a scratch database")
    ap.add_argument("--database-url", help="already migrated disposable database to compare")
    ap.add_argument("--markdown", help="write a markdown table to this path")
    ap.add_argument("--server-defaults", action="store_true", help="also compare server_default (noisy: models rely on Python defaults); off by default and not part of the baseline")
    ap.add_argument("--json", action="store_true", help="print rows as JSON")
    ap.add_argument("--check", action="store_true", help="fail if differences exceed the baseline")
    ap.add_argument("--write-baseline", action="store_true", help="store the current counts as the baseline")
    args = ap.parse_args()
    if bool(args.admin_url) == bool(args.database_url):
        ap.error("pass exactly one of --admin-url / --database-url")
    if args.database_url and re.search(r"/renova(\?|$)", args.database_url):
        ap.error("refusing to compare the live 'renova' database; use a scratch database")

    rows = run_on_scratch(args.admin_url, server_defaults=args.server_defaults) if args.admin_url else compare(args.database_url, server_defaults=args.server_defaults)
    summary = summarize(rows)
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        print(markdown(rows))
    if args.markdown:
        Path(args.markdown).write_text(markdown(rows), encoding="utf-8")
    if args.write_baseline:
        BASELINE_FILE.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.check and summary["total"] > load_baseline()["total"]:
        print(f"schema drift grew: {summary['total']} > baseline {load_baseline()['total']}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
