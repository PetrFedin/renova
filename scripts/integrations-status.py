#!/usr/bin/env python3
"""Читает GET /api/v1/admin/integrations/status и печатает сводку (секретов в ответе нет).

    RENOVA_API_URL=https://api.example RENOVA_ADMIN_TOKEN=<bearer админа> \
        python3 scripts/integrations-status.py [--require payments,storage,sms_otp]

Код выхода 1, если среди --require есть интеграция не в состоянии configured
(по умолчанию — все с critical=true). Токен берётся только из окружения.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require", default="", help="ключи через запятую; по умолчанию все critical")
    args = parser.parse_args()
    base = (os.environ.get("RENOVA_API_URL") or "").rstrip("/")
    token = os.environ.get("RENOVA_ADMIN_TOKEN") or ""
    if not base or not token:
        print("нужны RENOVA_API_URL и RENOVA_ADMIN_TOKEN", file=sys.stderr)
        return 2
    request = urllib.request.Request(
        f"{base}/api/v1/admin/integrations/status", headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - URL задаёт оператор
        report = json.load(response)
    required = {k.strip() for k in args.require.split(",") if k.strip()}
    failed = 0
    for item in report["integrations"]:
        need = item["key"] in required if required else item["critical"]
        mark = "OK " if item["configured"] else ("-- " if not need else "FAIL")
        if need and not item["configured"]:
            failed += 1
        missing = ",".join(item["missing_keys"]) or "-"
        print(f"{mark:4} {item['key']:14} {item['state']:13} provider={item['provider']:16} missing={missing}")
    print(f"verification={report['verification']} (живые вызовы провайдеров не выполнялись)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
