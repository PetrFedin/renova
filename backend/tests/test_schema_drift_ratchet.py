"""APIB-039 ratchet: model-vs-migration schema drift may only shrink.

The Postgres comparison needs a server where a scratch database can be created
(``POSTGRES_TEST_URL``, any database on that server, e.g.
``postgresql://renova:renova@127.0.0.1:5433/postgres``); without it that test is
skipped, like the other Postgres-only checks.  The baseline lives in
``scripts/schema_drift_baseline.json``; after closing drift run
``python -m scripts.schema_drift_report --admin-url $POSTGRES_TEST_URL --write-baseline``.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "schema_drift_report.py"


def _module():
    spec = importlib.util.spec_from_file_location("schema_drift_report", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_baseline_file_is_consistent():
    baseline = json.loads(SCRIPT.with_name("schema_drift_baseline.json").read_text(encoding="utf-8"))
    assert baseline["total"] == sum(baseline["by_kind"].values())
    assert baseline["total"] >= 0


@pytest.mark.skipif(not os.environ.get("POSTGRES_TEST_URL"), reason="POSTGRES_TEST_URL is not set")
def test_schema_drift_does_not_grow():
    mod = _module()
    rows = mod.run_on_scratch(os.environ["POSTGRES_TEST_URL"])
    now = mod.summarize(rows)
    baseline = mod.load_baseline()
    assert now["total"] <= baseline["total"], (
        f"schema drift grew {baseline['total']} -> {now['total']}; fix the model or add a migration.\n"
        + mod.markdown(rows)
    )
    for kind, count in now["by_kind"].items():
        assert count <= baseline["by_kind"].get(kind, 0), f"drift kind {kind!r} grew to {count}\n{mod.markdown(rows)}"
