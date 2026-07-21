#!/usr/bin/env bash
# Fail if high-risk secret patterns appear in tracked files. Prints path + type only.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
from pathlib import Path
import re, subprocess, sys

patterns = [
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"), "private_key"),
    (re.compile(r"sk_live_[A-Za-z0-9]{20,}"), "payment_live_key"),
    (re.compile(r"ghp_[A-Za-z0-9]{36}"), "github_pat"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "slack_token"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "aws_access_key_id"),
    (re.compile(r"-----BEGIN PRIVATE KEY-----"), "private_key"),
    (re.compile(r"bot[0-9]{8,}:[A-Za-z0-9_-]{30,}"), "telegram_bot_token"),
]

skip_parts = ("node_modules", ".venv", "package-lock", ".png", ".jpg", ".webp", ".lock")
tracked = subprocess.check_output(["git", "ls-files"], text=True).splitlines()
hits = []
for rel in tracked:
    if any(s in rel for s in skip_parts):
        continue
    p = Path(rel)
    if not p.is_file() or p.stat().st_size > 1_500_000:
        continue
    if rel.endswith(".example"):
        continue
    try:
        text = p.read_text(errors="ignore")
    except Exception:
        continue
    for pat, kind in patterns:
        if pat.search(text):
            hits.append((rel, kind))
            break

if hits:
    print("SECRET SCAN FAIL (path + type only):")
    for path, kind in hits:
        print(f"  {path}\t{kind}")
    print("See docs/SECURITY-REMEDIATION.md — rotate out-of-band; do not paste values.")
    sys.exit(1)
print("SECRET SCAN PASS (0 hits)")
PY
