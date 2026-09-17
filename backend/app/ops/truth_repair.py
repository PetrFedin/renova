"""Explicit operator entry point for the legacy truth repairs.

    python -m app.ops.truth_repair            # apply
    python -m app.ops.truth_repair --dry-run  # report only, no write

These three repairs rewrite real business rows: receipt verification state and
the expenses derived from it, Moy Nalog provider connections, and OCR
suggestions. They used to run inside FastAPI's lifespan, which meant they
executed on every API start — every deploy, every restart, every replica and
every rollback — with N replicas racing concurrent passes over the same tables
and no bound on how long the pass takes.

They are idempotent, so that was survivable, not correct. A data migration is
an operator action with a decision, a log and a result; it is not a side effect
of a process starting.

The repair functions themselves are unchanged and still called from
``init_db`` in local/test, so a developer database stays self-healing.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys

from app.core.logging_config import setup_logging
from app.db.session import SessionLocal, engine

logger = logging.getLogger("renova.ops.truth_repair")


async def run(*, dry_run: bool) -> dict[str, dict[str, int]]:
    from app.services.document_ocr_truth_repair import repair_legacy_ocr_truth
    from app.services.fns.receipt_truth_repair import repair_legacy_receipt_truth
    from app.services.moy_nalog_truth_repair import repair_legacy_moy_nalog_truth

    async with SessionLocal() as db:
        receipts = await repair_legacy_receipt_truth(db)
        moy_nalog = await repair_legacy_moy_nalog_truth(db)
        ocr = await repair_legacy_ocr_truth(db)

        if dry_run:
            # The repairs mutate the session; rolling back leaves the database
            # untouched while still reporting exactly what would change.
            await db.rollback()
        else:
            await db.commit()

    return {"receipts": receipts, "moy_nalog": moy_nalog, "ocr": ocr}


def _changed(summary: dict[str, dict[str, int]]) -> int:
    return sum(
        value
        for section in summary.values()
        for value in section.values()
        if isinstance(value, int)
    )


async def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.ops.truth_repair")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing",
    )
    args = parser.parse_args(argv)

    setup_logging()
    try:
        summary = await run(dry_run=args.dry_run)
    finally:
        await engine.dispose()

    print(json.dumps({"dry_run": args.dry_run, **summary}, ensure_ascii=False, indent=2))
    logger.info(
        "truth repair finished dry_run=%s changed_rows=%s",
        args.dry_run,
        _changed(summary),
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
