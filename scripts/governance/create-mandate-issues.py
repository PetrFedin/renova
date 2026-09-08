#!/usr/bin/env python3
"""Create one GitHub issue per mandate task (A1..E4) from PRODUCT-COMPLETION-MANDATE.md.

Idempotent: matches existing issues by exact title prefix "[<ID>]".
Sets labels: agent-task, P<n>, phase:<X>, and `ready` for tasks with no unmet dependencies.
Run by the owner: python3 scripts/governance/create-mandate-issues.py --repo PetrFedin/renova
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

MANDATE = Path("docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md")

# Dependencies from README-APPLY §6 / mandate §2. A task becomes `ready` when all deps are closed.
DEPS: dict[str, list[str]] = {
    "A1": [], "A2": [], "A3": ["A2"], "A4": ["A3"], "A5": ["A2"], "A6": ["A2"], "A7": ["A5", "A6"],
    "B1": ["A1"], "B2": ["B1"], "B3": ["A4"], "B4": ["B1"], "B5": ["B4"],
    "C1": ["A5", "B1"], "C2": ["C1"], "C3": ["C1"], "C4": ["C1"], "C5": ["C1"], "C6": ["C1"], "C7": ["C1"], "C8": ["C2", "C3"],
    "D1": ["B2", "B3", "B5", "C8"], "D2": ["D1"], "D3": ["D1"],
    "E1": ["D1"], "E2": ["D1"], "E3": ["D3", "E1"], "E4": [],
}
PARALLEL = {
    "A1": "A2", "A2": "A1", "A3": "A5, A6", "A5": "A3, A6", "A6": "A3, A5", "A4": "A7", "A7": "A4",
    "B1": "B3", "B3": "B1", "C2": "C3, C4, C5, C6, C7", "C3": "C2, C4, C5, C6, C7", "C4": "C2, C3, C5, C6, C7",
    "C5": "C2, C3, C4, C6, C7", "C6": "C2, C3, C4, C5, C7", "C7": "C2, C3, C4, C5, C6",
}


def gh(*args: str, dry: bool = False) -> str:
    if dry:
        print("   [dry] gh", " ".join(args))
        return ""
    return subprocess.check_output(["gh", *args], text=True)


def parse_tasks(text: str) -> list[dict]:
    # "**A1 · P0 · Title.**\nbody...\nEvidence: ..." blocks under "### Фаза"
    pattern = re.compile(r"\*\*([A-E]\d) · (P\d) · (.+?)\*\*\s*(.*?)(?=\n\*\*[A-E]\d · |\n### |\n---|\Z)", re.S)
    tasks = []
    for m in pattern.finditer(text):
        tid, prio, title, body = m.group(1), m.group(2), m.group(3).rstrip("."), m.group(4).strip()
        ev = ""
        if "Evidence:" in body:
            body, ev = body.split("Evidence:", 1)
        tasks.append({"id": tid, "prio": prio, "title": title.strip(), "scope": body.strip(), "evidence": ev.strip()})
    return tasks


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if not MANDATE.exists():
        print(f"missing {MANDATE}; copy the mandate bundle first", file=sys.stderr)
        return 1
    tasks = parse_tasks(MANDATE.read_text(encoding="utf-8"))
    if len(tasks) < 25:
        print(f"parsed only {len(tasks)} tasks — mandate format changed?", file=sys.stderr)
        return 1

    existing = json.loads(gh("issue", "list", "-R", a.repo, "--state", "all", "--limit", "500", "--json", "number,title,state", "--label", "agent-task") or "[]") if not a.dry_run else []
    by_id = {}
    for it in existing:
        m = re.match(r"\[([A-E]\d)\]", it["title"])
        if m:
            by_id[m.group(1)] = it

    created = 0
    for t in tasks:
        tid = t["id"]
        deps = DEPS.get(tid, [])
        deps_closed = all(by_id.get(d, {}).get("state") == "CLOSED" for d in deps) if deps else True
        labels = ["agent-task", t["prio"], f"phase:{tid[0]}"] + (["ready"] if deps_closed else ["blocked"])
        title = f"[{tid}] {t['title']}"
        body = (
            f"### Mandate ID\n{tid}\n\n"
            f"### Scope (verbatim from the mandate)\n{t['scope']}\n\n"
            f"### Required evidence (from the mandate)\n{t['evidence'] or 'see mandate'}\n\n"
            f"### Known files / chain (agent completes before starting)\n_to be filled by the agent_\n\n"
            f"### Depends on\n{', '.join('[' + d + ']' for d in deps) or 'none'}\n\n"
            f"### Can run in parallel with\n{PARALLEL.get(tid, 'see mandate §2 table')}\n\n"
            f"Source: `docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md` §4. Branch: `agent/{tid}-<slug>`. "
            f"PR must use the template; never close #300 from a PR."
        )
        if tid in by_id:
            gh("issue", "edit", str(by_id[tid]["number"]), "-R", a.repo, "--body", body, dry=a.dry_run)
            print(f"   = {title} (#{by_id[tid]['number']} updated)")
        else:
            out = gh("issue", "create", "-R", a.repo, "-t", title, "-b", body, *sum((["-l", l] for l in labels), []), dry=a.dry_run)
            created += 1
            print(f"   + {title} {out.strip()}")
    print(f"   {created} created, {len(tasks) - created} updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
