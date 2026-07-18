#!/usr/bin/env bash
# Trash leftover "E2E Contract Gate *" projects for demo customer.
set -euo pipefail
API="${API:-http://127.0.0.1:8100}"
python3 << PY
import json, os, urllib.request

api = os.environ.get("API", "http://127.0.0.1:8100")

def post(path, body=None, headers=None):
    data = json.dumps(body or {}).encode() if body is not None else b"{}"
    h = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(f"{api}{path}", data=data, headers=h, method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def get(path, headers=None):
    req = urllib.request.Request(f"{api}{path}", headers=headers or {})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

cust = post("/api/v1/auth/demo", {"role": "customer"})
cid = cust["id"]
projects = get("/api/v1/projects", {"X-User-Id": cid})
n = 0
for p in projects:
    name = p.get("name") or ""
    if not name.startswith("E2E Contract Gate"):
        continue
    try:
        post(f"/api/v1/projects/{p['id']}/trash", {}, {"X-User-Id": cid})
        print(f"trashed: {name}")
        n += 1
    except Exception as e:
        print(f"skip {p['id']}: {e}")
print(f"cleanup-e2e-gate-projects: trashed {n} project(s)")
PY
