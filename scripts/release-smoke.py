#!/usr/bin/env python3
"""Release smoke: critical path of Renova over real HTTP (stdlib only).

Usage:
  python3 scripts/release-smoke.py                       # read tier, API=http://127.0.0.1:8100
  API=http://127.0.0.1:8100 python3 scripts/release-smoke.py --write

Tiers
  read   (default) writes nothing: liveness/readiness, auth is enforced, demo
         accounts (development only) can read the seed project: detail, estimate,
         schedule, payments, documents, calendar, chats, notifications, and the
         guest viewer is read-only. Safe against a shared development stack.
  write  (--write) creates its OWN users (OTP dev-preview, random phones) and ONE
         new project, then walks: registration -> project -> contractor claim ->
         customer accepts -> estimate -> propose/lock -> contract two signatures
         -> schedule -> stage start -> checklist -> submit -> accept -> stage
         payment -> confirm -> budget consistency -> trash. It leaves data
         behind (a project with financial history cannot be purged), so run it
         ONLY against a scratch/disposable stack. Refuses ENVIRONMENT other than
         development/test (it detects this from /health) unless RENOVA_SMOKE_FORCE=1.

Exit code 0 = all checks passed, 1 = at least one failed, 2 = stack unreachable.
No secrets are read or printed; tokens stay in process memory.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("API", "http://127.0.0.1:8100").rstrip("/")
TIMEOUT = float(os.environ.get("SMOKE_TIMEOUT", "20"))

PNG = "data:image/png;base64," + base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082"
    )
).decode()

results: list[tuple[str, bool, str]] = []


def http(method: str, path: str, token: str | None = None, body=None, prefix: str = "/api/v1"):
    url = API + prefix + path
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        status = exc.code
    try:
        payload = json.loads(raw) if raw else None
    except ValueError:
        payload = raw[:200].decode("utf-8", "replace")
    return status, payload


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not ok else ""))
    return bool(ok)


def expect(name: str, resp, codes, extra=None):
    status, payload = resp
    codes = (codes,) if isinstance(codes, int) else tuple(codes)
    ok = status in codes
    if ok and extra is not None:
        try:
            ok = bool(extra(payload))
        except Exception as exc:  # shape mismatch is a failed check, not a crash
            return check(name, False, f"shape: {type(exc).__name__}"), payload
    return check(name, ok, f"HTTP {status}, expected {codes}: {str(payload)[:160]}"), payload


# ----------------------------------------------------------------------------- tiers


def probe_runtime() -> dict:
    print("== runtime")
    try:
        status, health = http("GET", "/health", prefix="")
    except Exception as exc:
        print(f"stack unreachable at {API}: {type(exc).__name__}")
        sys.exit(2)
    expect("GET /health ok", (status, health), 200, lambda p: p["status"] == "ok" and p["service"] == "renova-api")
    expect("GET /ready ready (DB query)", http("GET", "/ready", prefix=""), 200, lambda p: p["status"] == "ready")
    if isinstance(health, dict):
        print(f"  info: environment={health.get('environment')} version={health.get('version')} "
              f"release={health.get('release')} worker={health.get('background_runtime')}")
    return health if isinstance(health, dict) else {}


def auth_is_enforced() -> None:
    print("== auth is enforced")
    for path in ("/projects", "/notifications"):
        expect(f"anonymous GET {path} rejected", http("GET", path), (401, 403))
    expect("garbage bearer rejected", http("GET", "/projects", token="not.a.jwt"), (401, 403))
    expect("wrong OTP rejected", http("POST", "/auth/sms/verify",
                                      body={"phone": "+79990009999", "code": "000000", "role": "customer"}),
           (400, 401, 403, 422))


def demo_session(role: str):
    status, payload = http("POST", "/auth/demo", body={"role": role})
    if status != 200 or not isinstance(payload, dict) or not payload.get("access_token"):
        return None
    return payload


def read_tier(env_name: str) -> None:
    print("== read tier (writes nothing)")
    if env_name not in ("development", "test"):
        print("  skip: demo accounts exist only in development/test; non-dev stacks need real tokens")
        return
    cust = demo_session("customer")
    cont = demo_session("contractor")
    if not (cust and cont):
        print("  skip: demo accounts unavailable (demo seed disabled); run the write tier on a scratch stack")
        return
    check("demo accounts available", True)
    tc, tk = cust["access_token"], cont["access_token"]
    ok, projects = expect("customer lists projects", http("GET", "/projects", tc), 200, lambda p: isinstance(p, list))
    if not ok or not projects:
        check("seed project present", False, "no projects; run `bash scripts/dev-runtime.sh seed`")
        return
    pid = next((p["id"] for p in projects if p.get("contractor_id")), projects[0]["id"])
    P = f"/projects/{pid}"
    _, detail = expect("project detail has stages/estimate/budget", http("GET", P, tc), 200,
                       lambda p: p["stages"] and "estimate_lines" in p and "budget_planned" in p)
    for label, sub in (("payments", "/payments"), ("documents", "/documents"), ("calendar", "/calendar"),
                       ("chats", "/chats"), ("work schedules", "/work-schedules"),
                       ("contract gate", "/contract-gate"), ("dashboard", "/dashboard")):
        expect(f"customer reads {label}", http("GET", P + sub, tc), 200)
    expect("customer notifications", http("GET", "/notifications", tc), 200)
    _, dash = http("GET", P + "/dashboard", tc)
    if isinstance(detail, dict) and isinstance(dash, dict) and "progress_percent" in dash:
        check("progress consistent: detail vs dashboard",
              abs(float(detail.get("progress_percent", 0)) - float(dash["progress_percent"])) < 1)
    expect("contractor lists projects", http("GET", "/projects", tk), 200, lambda p: isinstance(p, list))
    status, guest = http("POST", "/auth/demo/guest")
    if status == 200 and isinstance(guest, dict) and guest.get("access_token"):
        tg = guest["access_token"]
        expect("guest viewer cannot comment on a stage", http(
            "POST", f"{P}/stages/{detail['stages'][0]['id']}/comments", tg, {"text": "smoke"}), (403, 404))
        expect("guest cannot lock estimate", http("POST", P + "/estimate/propose-lock", tg), (403, 404))
    else:
        print("  skip: guest demo session unavailable")


def write_tier(env_name: str) -> None:
    print("== write tier (creates users + one project)")
    if env_name not in ("development", "test") and os.environ.get("RENOVA_SMOKE_FORCE") != "1":
        check("write tier allowed on this environment", False, f"environment={env_name}")
        return

    suffix = f"{random.randint(0, 9_999_999):07d}"
    phones = {"cust": f"+7901{suffix}", "lead": f"+7902{suffix}", "other": f"+7903{suffix}", "guest": f"+7904{suffix}"}
    roles = {"cust": "customer", "lead": "contractor", "other": "contractor", "guest": "customer"}
    tok: dict[str, str] = {}
    uid: dict[str, str] = {}
    for who, phone in phones.items():
        status, sent = http("POST", "/auth/sms/send", body={"phone": phone})
        code = sent.get("demo_code") if isinstance(sent, dict) else None
        if not check(f"register {who}: OTP preview available", status == 200 and bool(code), f"HTTP {status}"):
            return
        status, user = http("POST", "/auth/sms/verify",
                            body={"phone": phone, "code": code, "role": roles[who], "full_name": f"Smoke {who}"})
        if not check(f"register {who}: verify", status == 200 and isinstance(user, dict) and "access_token" in user,
                     f"HTTP {status}"):
            return
        tok[who], uid[who] = user["access_token"], user["id"]

    def call(who, method, path, body=None):
        return http(method, path, tok[who], body)

    print("-- project and contractor claim")
    ok, proj = expect("customer creates project", call("cust", "POST", "/projects", {
        "name": "Smoke: квартира", "address": "Москва, Смоук 1", "renovation_type": "cosmetic",
        "property_type": "apartment", "total_area_sqm": 30,
        "rooms": [{"name": "Комната", "area_sqm": 15, "length_m": 5, "width_m": 3}]}), 200,
        lambda p: p["stages"] and p["budget_planned"] > 0)
    if not ok:
        return
    pid = proj["id"]
    P = f"/projects/{pid}"
    stage = next((s for s in proj["stages"] if s["name"] == "Демонтаж"), proj["stages"][0])
    expect("unassigned contractor has no access", call("lead", "GET", P), (403, 404))
    ok, req = expect("contractor claims project -> pending", call("lead", "POST", P + "/assign"), 202,
                     lambda p: p["request"]["status"] == "pending")
    if not ok:
        return
    expect("contractor cannot self-accept", call("lead", "POST", f"{P}/assignment-requests/{req['request']['id']}/accept"), 403)
    expect("customer accepts claim", call("cust", "POST", f"{P}/assignment-requests/{req['request']['id']}/accept"),
           200, lambda p: p["status"] == "accepted")
    expect("contractor now has access", call("lead", "GET", P), 200, lambda p: p["access_mode"] == "contractor")
    expect("outsider contractor still has no access", call("other", "GET", P), (403, 404))

    print("-- estimate, lock, contract")
    expect("customer cannot add estimate lines", call("cust", "POST", P + "/estimate/lines", {
        "line_type": "work", "name": "X", "unit": "m2", "quantity_planned": 1, "unit_price": 1}), 403)
    body = {"line_type": "work", "name": "Штукатурка стен", "unit": "m2", "quantity_planned": 60,
            "unit_price": 450, "category": "walls", "client_request_id": f"smoke-line-{suffix}"}
    ok, first = expect("contractor adds estimate line", call("lead", "POST", P + "/estimate/lines", body), 200)
    if ok:
        expect("same client_request_id is an idempotent replay",
               call("lead", "POST", P + "/estimate/lines", body), 200,
               lambda p: p["id"] == first["id"] and p["idempotent_replay"] is True)
    expect("negative price rejected", call("lead", "POST", P + "/estimate/lines", {
        "line_type": "work", "name": "neg", "unit": "m2", "quantity_planned": 1, "unit_price": -5}), (400, 422))
    expect("contractor proposes lock", call("lead", "POST", P + "/estimate/propose-lock"), 200)
    ok, locked = expect("customer locks estimate -> contract document", call("cust", "POST", P + "/estimate/lock"),
                        200, lambda p: p["ok"] is True and p["contract"]["document_id"])
    if not ok:
        return
    doc = locked["contract"]["document_id"]
    expect("stage start blocked before signatures", call("lead", "POST", f"{P}/stages/{stage['id']}/start"), 403,
           lambda p: "contract_not_signed" in json.dumps(p))
    expect("contractor signs", call("lead", "POST", f"{P}/documents/{doc}/sign", {"provider": "in_app"}), 200)
    expect("gate still closed after one signature", call("cust", "GET", P + "/contract-gate"), 200,
           lambda p: p["ok"] is False)
    expect("customer signs", call("cust", "POST", f"{P}/documents/{doc}/sign", {"provider": "in_app"}), 200)
    expect("gate open after both signatures", call("cust", "GET", P + "/contract-gate"), 200, lambda p: p["ok"] is True)
    expect("contract pdf renders", call("cust", "GET", P + "/contract.pdf"), 200)

    print("-- schedule")
    _, cur = call("cust", "GET", P)
    stages = cur["stages"]
    ok, sch = expect("contractor creates schedule", call("lead", "POST", P + "/work-schedules", {
        "title": "План-график", "items": [], "client_request_id": f"smoke-sch-{suffix}"}), 200,
        lambda p: p["status"] == "draft")
    if ok:
        items = [{"stage_id": s["id"], "title": s["name"], "planned_start_date": "2026-10-05",
                  "planned_finish_date": "2026-10-12", "sort_order": i} for i, s in enumerate(stages[:3])]
        expect("schedule items saved", call("lead", "PUT", f"{P}/work-schedules/{sch['id']}", {"items": items}), 200)
        expect("contractor submits schedule", call("lead", "POST", f"{P}/work-schedules/{sch['id']}/submit"), 200)
        expect("contractor cannot confirm own schedule", call("lead", "POST", f"{P}/work-schedules/{sch['id']}/confirm"), (403, 409))
        expect("customer confirms schedule", call("cust", "POST", f"{P}/work-schedules/{sch['id']}/confirm"), 200,
               lambda p: p["status"] == "confirmed")

    print("-- stage execution and acceptance")
    sid = stage["id"]
    expect("customer cannot start stage", call("cust", "POST", f"{P}/stages/{sid}/start"), 403)
    expect("contractor starts stage", call("lead", "POST", f"{P}/stages/{sid}/start"), 200,
           lambda p: p["status"] == "active")
    _, wf = call("lead", "GET", f"{P}/stages/{sid}/workflow")
    checklist = (wf or {}).get("checklist") or []
    check("stage has a checklist", bool(checklist))
    expect("submit with open checklist refused", call("lead", "POST", f"{P}/stages/{sid}/submit"), (400, 409, 422))
    for item in checklist:
        call("lead", "POST", f"{P}/stages/{sid}/checklist/toggle", {"item_id": item["id"], "done": True})
    expect("contractor uploads stage photo", call("lead", "POST", f"{P}/stages/{sid}/photos",
                                                  {"image_data": PNG, "caption": "Результат: демонтаж"}), 200)
    ok, sub = expect("contractor submits stage", call("lead", "POST", f"{P}/stages/{sid}/submit"), 200,
                     lambda p: p["acceptance_id"])
    if not ok:
        return
    acc = sub["acceptance_id"]
    expect("contractor cannot accept own work", call("lead", "POST", f"{P}/work-acceptances/{acc}/accept", {"quality_score": 10}), (403, 404))
    ok, accepted = expect("customer accepts -> stage payment created",
                          call("cust", "POST", f"{P}/work-acceptances/{acc}/accept", {"quality_score": 9, "comment": "smoke"}),
                          200, lambda p: p["payment_id"])
    if not ok:
        return
    pay = accepted["payment_id"]
    expect("accept is idempotent", call("cust", "POST", f"{P}/work-acceptances/{acc}/accept", {"quality_score": 9}), 200)
    expect("stage is done", call("cust", "GET", f"{P}/stages/{sid}"), 200, lambda p: p["status"] == "done")

    print("-- payment")
    expect("confirm without transfer ack refused", call("cust", "POST", f"{P}/payments/{pay}/confirm", {}), (400, 409, 422))
    expect("contractor cannot confirm payment", call("lead", "POST", f"{P}/payments/{pay}/confirm", {"transfer_ack": True}), (403, 404))
    expect("customer confirms payment", call("cust", "POST", f"{P}/payments/{pay}/confirm", {"transfer_ack": True}),
           200, lambda p: p["status"] in ("confirmed", "paid_unverified", "paid"))
    expect("payment visible to both sides", call("lead", "GET", P + "/payments"), 200,
           lambda p: any(x["id"] == pay for x in p))

    print("-- consistency")
    _, det = call("cust", "GET", P)
    _, dash = call("cust", "GET", P + "/dashboard")
    check("progress > 0 and detail == dashboard",
          isinstance(det, dict) and isinstance(dash, dict) and det["progress_percent"] > 0
          and abs(det["progress_percent"] - dash["progress_percent"]) < 1,
          f"{det.get('progress_percent') if isinstance(det, dict) else '?'} vs {dash.get('progress_percent') if isinstance(dash, dict) else '?'}")

    print("-- guest viewer is read-only")
    expect("customer invites viewer", call("cust", "POST", P + "/viewers", {"phone": phones["guest"]}), (200, 201))
    status, _ = call("guest", "GET", P)
    check("viewer can read project", status == 200, f"HTTP {status}")
    expect("viewer cannot comment", call("guest", "POST", f"{P}/stages/{sid}/comments", {"text": "x"}), 403)

    print("-- trash")
    expect("outsider cannot trash project", call("other", "POST", P + "/trash"), (403, 404))
    expect("customer trashes project", call("cust", "POST", P + "/trash"), 200)
    expect("purge refused: financial history", call("cust", "DELETE", P), 409,
           lambda p: p["detail"]["code"] == "financial_history_blocks_purge")
    print(f"  note: smoke project {pid} stays in trash (financial history blocks purge); users {', '.join(phones.values())}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true", help="also run the write tier (scratch stacks only)")
    args = parser.parse_args()
    started = time.time()
    print(f"Renova release smoke -> {API}")
    health = probe_runtime()
    env_name = str(health.get("environment", "unknown"))
    auth_is_enforced()
    read_tier(env_name)
    if args.write:
        write_tier(env_name)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed in {time.time() - started:.1f}s"
          f" (tier: {'read+write' if args.write else 'read'})")
    for name, _ok, detail in failed:
        print(f"FAILED: {name}: {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
