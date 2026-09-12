#!/usr/bin/env python3
"""Fail closed on newly added mobile UI drift without grandfathered-repo cleanup.

This gate intentionally inspects only added product-code lines in a PR diff. Existing
legacy debt stays governed by its bounded migration issues; new debt cannot grow.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

HEX_RE = re.compile(r"#[0-9A-Fa-f]{3,8}\b")
BANNED_OPERATIONAL_EMOJI = ("⚙", "📷", "🎤", "🔒")

ALLOWED_TOKEN_FILES = {
    "apps/mobile/constants/Theme.ts",
    "apps/mobile/constants/uiTokens.ts",
}


def is_product_source(path: str) -> bool:
    if not path.startswith("apps/mobile/"):
        return False
    if not (path.endswith(".ts") or path.endswith(".tsx")):
        return False
    if path in ALLOWED_TOKEN_FILES:
        return False
    if "/__tests__/" in path or path.endswith(".test.ts") or path.endswith(".test.tsx"):
        return False
    return True


def line_violations(path: str, added_line: str) -> list[str]:
    if not is_product_source(path):
        return []
    text = added_line.strip()
    if not text or text.startswith("//") or text.startswith("*"):
        return []
    violations: list[str] = []
    if HEX_RE.search(text):
        violations.append("raw hex outside Theme/uiTokens")
    found = [emoji for emoji in BANNED_OPERATIONAL_EMOJI if emoji in text]
    if found:
        violations.append(f"operational emoji {''.join(found)}")
    return violations


def scan_patch(patch: str) -> list[str]:
    path = ""
    failures: list[str] = []
    new_line = 0
    for raw in patch.splitlines():
        if raw.startswith("+++ b/"):
            path = raw[6:]
            new_line = 0
            continue
        if raw.startswith("@@"):
            match = re.search(r"\+(\d+)(?:,(\d+))?", raw)
            new_line = int(match.group(1)) - 1 if match else 0
            continue
        if raw.startswith("+") and not raw.startswith("+++"):
            new_line += 1
            for reason in line_violations(path, raw[1:]):
                failures.append(f"{path}:{new_line}: {reason}: {raw[1:].strip()}")
        elif raw.startswith(" "):
            new_line += 1
    return failures


def git_diff(base: str, head: str) -> str:
    proc = subprocess.run(
        [
            "git",
            "diff",
            "--unified=0",
            "--no-color",
            f"{base}...{head}",
            "--",
            "apps/mobile/**/*.ts",
            "apps/mobile/**/*.tsx",
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    return proc.stdout


def self_test() -> None:
    assert line_violations("apps/mobile/components/Foo.tsx", "color: '#fff'")
    assert line_violations("apps/mobile/components/Foo.tsx", "<Text>🔒</Text>")
    assert not line_violations("apps/mobile/constants/Theme.ts", "primary: '#123456'")
    assert not line_violations("apps/mobile/lib/foo.test.ts", "expect(x).toBe('#fff')")
    assert not line_violations("apps/mobile/components/Foo.tsx", "color: RenovaTheme.colors.text")
    sample = """diff --git a/apps/mobile/components/Foo.tsx b/apps/mobile/components/Foo.tsx
+++ b/apps/mobile/components/Foo.tsx
@@ -1,0 +2,2 @@
+const bad = '#abc';
+const good = RenovaTheme.colors.text;
"""
    failures = scan_patch(sample)
    assert len(failures) == 1 and "Foo.tsx:2" in failures[0]
    print("mobile-design-diff-integrity self-test OK")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0
    if not args.base or not args.head:
        parser.error("--base and --head are required unless --self-test is used")

    failures = scan_patch(git_diff(args.base, args.head))
    if failures:
        print("New mobile design-system drift detected:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        print(
            "Use RenovaTheme/uiTokens/Ionicons or document a narrowly-scoped exception in the governed UI contract.",
            file=sys.stderr,
        )
        return 1

    print("mobile design diff integrity OK: no new raw semantic hex / banned operational emoji")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
