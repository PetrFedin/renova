#!/usr/bin/env python3
"""Validate Renova's bounded task-specific Agent Skills and client-routing layer using stdlib only."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

EXPECTED_SKILLS = {
    "renova-product-engineering",
    "context-engineering",
    "ui-ux-review",
    "writing-quality",
}
EXPECTED_UPSTREAM = {
    "context-engineering": {"repository": "muratcankoylan/Agent-Skills-for-Context-Engineering", "adopted_as": ["context-engineering"]},
    "ui-ux-review": {"repository": "nextlevelbuilder/ui-ux-pro-max-skill", "adopted_as": ["ui-ux-review"]},
    "writing-quality": {"repository": "hardikpandya/stop-slop", "adopted_as": ["writing-quality"]},
}
EXPECTED_PLATFORMS = {
    "claude": {"path": ".agent/platforms/claude.md"},
    "cursor": {"path": ".agent/platforms/cursor.md"},
    "codex": {"path": ".agent/platforms/codex.md"},
    "gpt": {"path": ".agent/platforms/gpt.md"},
}
FRONTMATTER_KEYS = {"name", "description"}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

@dataclass
class Result:
    passed: int = 0
    failures: list[str] | None = None
    def __post_init__(self) -> None:
        if self.failures is None:
            self.failures = []
    def check(self, condition: bool, message: str) -> None:
        if condition:
            self.passed += 1
        else:
            assert self.failures is not None
            self.failures.append(message)

def parse_frontmatter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing opening frontmatter delimiter")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration as exc:
        raise ValueError("missing closing frontmatter delimiter") from exc
    data: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"invalid frontmatter line: {line!r}")
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if not key or not value:
            raise ValueError(f"empty frontmatter key/value: {line!r}")
        if key in data:
            raise ValueError(f"duplicate frontmatter key: {key}")
        data[key] = value
    return data, "\n".join(lines[end + 1:]).strip()

def validate(root: Path) -> Result:
    result = Result()
    skills_root = root / ".agent" / "skills"
    result.check(skills_root.is_dir(), ".agent/skills directory is missing")
    if not skills_root.is_dir():
        return result
    skill_dirs = {p.name for p in skills_root.iterdir() if p.is_dir() and (p / "SKILL.md").is_file()}
    result.check(skill_dirs == EXPECTED_SKILLS, f"skill set mismatch: expected {sorted(EXPECTED_SKILLS)}, got {sorted(skill_dirs)}")
    names: list[str] = []
    router_text = ""
    for skill_name in sorted(EXPECTED_SKILLS):
        path = skills_root / skill_name / "SKILL.md"
        result.check(path.is_file(), f"missing skill entrypoint: {path.relative_to(root)}")
        if not path.is_file():
            continue
        try:
            frontmatter, body = parse_frontmatter(path)
        except (OSError, ValueError) as exc:
            result.check(False, f"{path.relative_to(root)} frontmatter error: {exc}")
            continue
        result.check(set(frontmatter) == FRONTMATTER_KEYS, f"{path.relative_to(root)} frontmatter must contain only name and description")
        name = frontmatter.get("name", "")
        names.append(name)
        result.check(name == skill_name, f"{path.relative_to(root)} name must match directory")
        result.check(len(frontmatter.get("description", "")) >= 40, f"{path.relative_to(root)} description is too short")
        result.check(bool(body), f"{path.relative_to(root)} body is empty")
        if skill_name == "renova-product-engineering":
            router_text = body
    result.check(len(names) == len(set(names)), "skill names are not unique")
    for routed in sorted(EXPECTED_SKILLS - {"renova-product-engineering"}):
        expected_path = f".agent/skills/{routed}/SKILL.md"
        result.check(expected_path in router_text, f"router does not reference {expected_path}")

    platforms_root = root / ".agent" / "platforms"
    result.check(platforms_root.is_dir(), ".agent/platforms directory is missing")
    if platforms_root.is_dir():
        platform_files = {p.stem for p in platforms_root.glob("*.md") if p.is_file()}
        result.check(platform_files == set(EXPECTED_PLATFORMS), f"platform adapter set mismatch: {sorted(platform_files)}")
        for platform, spec in EXPECTED_PLATFORMS.items():
            path = root / spec["path"]
            result.check(path.is_file(), f"missing platform adapter: {spec['path']}")
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8")
            result.check(bool(text.strip()), f"platform adapter is empty: {spec['path']}")
            result.check("AGENTS.md" in text, f"platform adapter must defer to AGENTS.md: {spec['path']}")
            result.check(".agent/kickoff.md" in text, f"platform adapter must route through kickoff: {spec['path']}")
            result.check("renova-product-engineering" in text, f"platform adapter must reference shared router: {spec['path']}")

    native = {
        "CLAUDE.md": root / "CLAUDE.md",
        "cursor": root / ".cursor" / "rules" / "renova-agent-runtime.mdc",
        "AGENTS.md": root / "AGENTS.md",
    }
    for label, path in native.items():
        result.check(path.is_file(), f"missing native client entrypoint: {label}")
    if native["CLAUDE.md"].is_file():
        result.check(EXPECTED_PLATFORMS["claude"]["path"] in native["CLAUDE.md"].read_text(encoding="utf-8"), "CLAUDE.md must route to Claude adapter")
    if native["cursor"].is_file():
        cursor_text = native["cursor"].read_text(encoding="utf-8")
        result.check(EXPECTED_PLATFORMS["cursor"]["path"] in cursor_text, "Cursor runtime rule must route to Cursor adapter")
        result.check("alwaysApply: true" in cursor_text, "Cursor runtime rule must remain alwaysApply")
    if native["AGENTS.md"].is_file():
        agents_text = native["AGENTS.md"].read_text(encoding="utf-8")
        result.check(EXPECTED_PLATFORMS["codex"]["path"] in agents_text, "AGENTS.md must route Codex to its adapter")
        result.check(EXPECTED_PLATFORMS["gpt"]["path"] in agents_text, "AGENTS.md must document the GPT adapter")

    kickoff_path = root / ".agent" / "kickoff.md"
    result.check(kickoff_path.is_file(), ".agent/kickoff.md is missing")
    if kickoff_path.is_file():
        kickoff = kickoff_path.read_text(encoding="utf-8")
        result.check(".agent/platforms/" in kickoff, "kickoff must reference platform adapters")
        result.check("host application" in kickoff.lower(), "kickoff must select by host application")
        result.check("foundation model" in kickoff.lower(), "kickoff must reject foundation-model routing")
        result.check("branch" in kickoff.lower() and "pull request" in kickoff.lower(), "kickoff must define GitHub-backed resume state")
    result.check(".agent/platforms/" in router_text, "router must reference platform adapters")
    result.check("host application" in router_text.lower(), "router must select adapter by host application")
    result.check("foundation model" in router_text.lower(), "router must reject foundation-model routing")

    lock_path = skills_root / "UPSTREAM.lock.json"
    result.check(lock_path.is_file(), "UPSTREAM.lock.json is missing")
    lock: dict = {}
    if lock_path.is_file():
        try:
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            result.check(isinstance(lock, dict), "UPSTREAM.lock.json must contain an object")
        except (OSError, json.JSONDecodeError) as exc:
            result.check(False, f"UPSTREAM.lock.json is invalid JSON: {exc}")
    if lock:
        result.check(lock.get("schema_version") == 1, "upstream lock schema_version must be 1")
        result.check(lock.get("policy") == "distilled-not-vendored", "upstream lock policy must be distilled-not-vendored")
        sources = lock.get("sources")
        result.check(isinstance(sources, list), "upstream lock sources must be a list")
        if isinstance(sources, list):
            source_ids = [s.get("id") for s in sources if isinstance(s, dict)]
            result.check(set(source_ids) == set(EXPECTED_UPSTREAM), f"upstream source IDs mismatch: {source_ids}")
            result.check(len(source_ids) == len(set(source_ids)), "upstream source IDs are not unique")
            for source in sources:
                if not isinstance(source, dict):
                    result.check(False, "upstream source entry must be an object")
                    continue
                source_id = source.get("id", "")
                expected = EXPECTED_UPSTREAM.get(source_id)
                result.check(expected is not None, f"unexpected upstream source: {source_id}")
                if expected is None:
                    continue
                repository = source.get("repository", "")
                result.check(bool(REPO_RE.fullmatch(repository)), f"invalid repository for {source_id}: {repository}")
                result.check(repository == expected["repository"], f"repository changed for {source_id}: {repository}")
                result.check(bool(SHA_RE.fullmatch(source.get("commit", ""))), f"commit for {source_id} must be an immutable 40-char SHA")
                result.check(source.get("license") == "MIT", f"license for {source_id} must be MIT")
                source_paths = source.get("source_paths")
                result.check(isinstance(source_paths, list) and bool(source_paths) and all(isinstance(p, str) and p for p in source_paths), f"source_paths missing for {source_id}")
                result.check(source.get("adopted_as") == expected["adopted_as"], f"adopted_as mismatch for {source_id}: {source.get('adopted_as')}")
                result.check(not any(k in source for k in ("branch", "ref", "tag")), f"floating upstream selector present for {source_id}")

    governance_doc = root / "docs" / "technical-spec" / "AGENT-SKILLS-GOVERNANCE.md"
    result.check(governance_doc.is_file(), "governance document is missing")
    if governance_doc.is_file():
        governance = governance_doc.read_text(encoding="utf-8")
        for required in ("AGENTS.md", "UPSTREAM.lock.json", "PR #364", "PR #366", "distilled-not-vendored", "Claude Code", "Cursor", "Codex", "ChatGPT/GPT", "host application"):
            result.check(required in governance, f"governance document must mention {required}")
    return result

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="repository root")
    args = parser.parse_args()
    result = validate(args.root.resolve())
    failures = result.failures or []
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        print(f"Agent Skills validation: {result.passed} passed, {len(failures)} failed")
        return 1
    print(f"Agent Skills validation: {result.passed} passed, 0 failed")
    return 0

if __name__ == "__main__":
    sys.exit(main())
