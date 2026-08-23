#!/usr/bin/env python3
"""Validate and render Renova's production-readiness source of truth.

Committed evidence contains audited, reviewable facts. Dynamic GitHub metadata
adds the actual evaluated SHA/current main SHA and live blocker states without
trying to embed a commit's own SHA inside that commit.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import urllib.error
import urllib.request
from copy import deepcopy
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE_PATH = ROOT / "docs" / "production-readiness-evidence.json"
APP_JSON_PATH = ROOT / "apps" / "mobile" / "app.json"
ALEMBIC_DIR = ROOT / "backend" / "alembic" / "versions"
DOC_PATH = ROOT / "PRODUCTION-READINESS.md"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
VERIFIED_EXTERNAL_STATUSES = {"VERIFIED", "SUCCESS_EXTERNAL", "DEPLOYED_VERIFIED"}


class ReadinessError(RuntimeError):
    pass


def _literal_assignment(path: Path, name: str) -> Any:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == name for target in targets):
            continue
        value = node.value
        if value is None:
            return None
        try:
            return ast.literal_eval(value)
        except (ValueError, TypeError) as exc:
            raise ReadinessError(f"{path}: {name} is not a literal") from exc
    raise ReadinessError(f"{path}: missing {name}")


def alembic_heads() -> list[str]:
    revisions: set[str] = set()
    down_revisions: set[str] = set()
    for path in sorted(ALEMBIC_DIR.glob("*.py")):
        if path.name.startswith("__"):
            continue
        revision = _literal_assignment(path, "revision")
        if not isinstance(revision, str) or not revision:
            raise ReadinessError(f"{path}: invalid revision")
        if revision in revisions:
            raise ReadinessError(f"duplicate Alembic revision: {revision}")
        revisions.add(revision)
        down = _literal_assignment(path, "down_revision")
        if down is None:
            continue
        values = [down] if isinstance(down, str) else list(down) if isinstance(down, (tuple, list)) else []
        if not values or any(not isinstance(item, str) or not item for item in values):
            raise ReadinessError(f"{path}: invalid down_revision")
        down_revisions.update(values)
    heads = sorted(revisions - down_revisions)
    if len(heads) != 1:
        raise ReadinessError(f"expected exactly one Alembic head, found {heads}")
    return heads


def repo_facts() -> dict[str, Any]:
    app = json.loads(APP_JSON_PATH.read_text(encoding="utf-8"))["expo"]
    return {
        "alembic_head": alembic_heads()[0],
        "mobile_version": str(app["version"]),
        "ios_build_number": str(app["ios"]["buildNumber"]),
        "android_version_code": int(app["android"]["versionCode"]),
    }


def _validate_manifest(evidence: dict[str, Any], facts: dict[str, Any]) -> None:
    if evidence.get("schema_version") != 1:
        raise ReadinessError("production readiness evidence schema_version must be 1")
    expected = evidence.get("expected_repo_facts")
    if expected != facts:
        raise ReadinessError(f"repo facts drifted: expected={expected!r} actual={facts!r}")

    blockers = evidence.get("open_launch_blockers")
    if not isinstance(blockers, list) or not blockers:
        raise ReadinessError("open_launch_blockers must be a non-empty list while launch is blocked")
    issue_numbers: set[int] = set()
    for blocker in blockers:
        issue = blocker.get("issue")
        if type(issue) is not int or issue <= 0:
            raise ReadinessError(f"invalid blocker issue: {blocker!r}")
        if issue in issue_numbers:
            raise ReadinessError(f"duplicate blocker issue: {issue}")
        issue_numbers.add(issue)
        if blocker.get("priority") not in {"P0", "P1", "P2"}:
            raise ReadinessError(f"invalid blocker priority for #{issue}")
        if not str(blocker.get("reason") or "").strip():
            raise ReadinessError(f"missing blocker reason for #{issue}")

    launch = evidence.get("launch_decision", {})
    if launch.get("status") == "READY_FOR_BROAD_PRODUCTION" and blockers:
        raise ReadinessError("broad-production READY is forbidden while launch blockers remain")

    risks = evidence.get("security", {}).get("accepted_risks", [])
    if not isinstance(risks, list):
        raise ReadinessError("security.accepted_risks must be a list")
    for risk in risks:
        missing = [key for key in ("id", "owner", "expires_on", "evidence") if not risk.get(key)]
        if missing:
            raise ReadinessError(f"accepted security risk missing {missing}: {risk!r}")

    def walk(value: Any, path: str = "evidence") -> None:
        if isinstance(value, dict):
            status = value.get("status")
            if status in VERIFIED_EXTERNAL_STATUSES and not value.get("evidence"):
                raise ReadinessError(f"{path}: external status {status} requires evidence")
            for key, child in value.items():
                walk(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{path}[{index}]")

    walk(evidence)


def _github_json(repo: str, path: str, token: str | None) -> Any:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/{path.lstrip('/')}",
        headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "renova-production-readiness",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        raise ReadinessError(f"GitHub metadata unavailable for {path}: {type(exc).__name__}") from exc


def github_truth(repo: str | None, token: str | None, blockers: list[dict[str, Any]]) -> dict[str, Any]:
    if not repo:
        return {
            "checked": False,
            "current_main_sha": None,
            "main_protected": None,
            "blocker_issue_states": {},
        }
    branch = _github_json(repo, "branches/main", token)
    main_sha = str(branch.get("commit", {}).get("sha") or "")
    if not SHA_RE.fullmatch(main_sha):
        raise ReadinessError(f"GitHub returned invalid main SHA: {main_sha!r}")
    states: dict[str, str] = {}
    for blocker in blockers:
        issue_number = int(blocker["issue"])
        issue = _github_json(repo, f"issues/{issue_number}", token)
        state = str(issue.get("state") or "unknown").lower()
        states[str(issue_number)] = state
        if state != "open":
            raise ReadinessError(
                f"readiness manifest lists #{issue_number} as an open launch blocker, but GitHub state is {state}; update the manifest"
            )
    return {
        "checked": True,
        "current_main_sha": main_sha,
        "main_protected": bool(branch.get("protected")),
        "blocker_issue_states": states,
    }


def _load_optional_identity(path: str | None, kind: str) -> dict[str, Any] | None:
    if not path:
        return None
    identity_path = Path(path)
    if not identity_path.is_file():
        raise ReadinessError(f"{kind} identity file not found: {path}")
    data = json.loads(identity_path.read_text(encoding="utf-8"))
    sha = str(data.get("git_sha") or "")
    if not SHA_RE.fullmatch(sha):
        raise ReadinessError(f"{kind} identity has invalid git_sha")
    return data


def build_snapshot(
    *,
    evaluated_sha: str,
    ref: str,
    repo: str | None,
    token: str | None,
    backend_image_identity: str | None,
    eas_release_identity: str | None,
) -> dict[str, Any]:
    if not SHA_RE.fullmatch(evaluated_sha):
        raise ReadinessError("--git-sha must be a full 40-character lowercase SHA")
    evidence = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
    facts = repo_facts()
    _validate_manifest(evidence, facts)
    dynamic = github_truth(repo, token, evidence["open_launch_blockers"])
    snapshot = deepcopy(evidence)
    snapshot["snapshot"] = {
        "evaluated_git_sha": evaluated_sha,
        "git_ref": ref,
        "current_main_sha": dynamic["current_main_sha"],
        "github_metadata_checked": dynamic["checked"],
        "main_protected": dynamic["main_protected"],
    }
    snapshot["repo_facts"] = facts
    snapshot["live_blocker_issue_states"] = dynamic["blocker_issue_states"]

    image_identity = _load_optional_identity(backend_image_identity, "backend image")
    if image_identity:
        snapshot["backend_artifact"] = {
            **snapshot["backend_artifact"],
            "status": "VERIFIED",
            "git_sha": image_identity["git_sha"],
            "digest": image_identity.get("digest"),
            "evidence": image_identity.get("evidence") or "backend-image-identity artifact",
            "identity": image_identity,
        }
        if not snapshot["backend_artifact"]["digest"]:
            raise ReadinessError("verified backend image identity is missing digest")

    release_identity = _load_optional_identity(eas_release_identity, "EAS release")
    if release_identity:
        snapshot["release"]["latest_eas_release"] = {
            "status": "VERIFIED",
            "git_sha": release_identity["git_sha"],
            "profile": release_identity.get("profile"),
            "builds": release_identity.get("builds", []),
            "evidence": release_identity.get("evidence") or "eas-release-identity artifact",
            "identity": release_identity,
        }
    return snapshot


def render_markdown(snapshot: dict[str, Any]) -> str:
    snap = snapshot["snapshot"]
    facts = snapshot["repo_facts"]
    backend = snapshot["backend_artifact"]
    envs = snapshot["environments"]
    slo = snapshot["slo"]
    restore = snapshot["restore"]["latest_repo_restore_drill"]
    release = snapshot["release"]["latest_eas_release"]
    security = snapshot["security"]
    blockers = snapshot["open_launch_blockers"]

    lines = [
        "# Renova production-readiness snapshot",
        "",
        f"- Evaluated SHA: `{snap['evaluated_git_sha']}`",
        f"- Current main SHA: `{snap['current_main_sha'] or 'UNAVAILABLE'}`",
        f"- Ref: `{snap['git_ref']}`",
        f"- Main protected: `{snap['main_protected']}`",
        f"- Launch decision: **{snapshot['launch_decision']['status']}**",
        "",
        "## Repository-derived facts",
        "",
        "| Fact | Value |",
        "|---|---|",
        f"| Alembic head | `{facts['alembic_head']}` |",
        f"| Mobile version | `{facts['mobile_version']}` |",
        f"| iOS build | `{facts['ios_build_number']}` |",
        f"| Android versionCode | `{facts['android_version_code']}` |",
        "",
        "## Evidence status",
        "",
        "| Area | Status | Evidence identity |",
        "|---|---|---|",
        f"| Backend immutable artifact | `{backend['status']}` | `{backend.get('digest') or 'not verified'}` |",
        f"| Staging | `{envs['staging']['status']}` | run `{envs['staging'].get('workflow_run_id') or 'n/a'}` |",
        f"| Production | `{envs['production']['status']}` | `{envs['production'].get('evidence') or 'none'}` |",
        f"| External capacity/SLO | `{slo['latest_external_load_test']['status']}` | `{slo['latest_external_load_test'].get('evidence') or 'none'}` |",
        f"| Latest repo restore drill | `{restore['status']}` | run `{restore['workflow_run_id']}` / `{restore['git_sha']}` |",
        f"| Latest EAS release | `{release['status']}` | `{release.get('evidence') or 'none'}` |",
        f"| Security repo controls | `{security['repo_controls']['status']}` | merge `{security['repo_controls']['merge_sha']}` |",
        "",
        "## Provider truth",
        "",
        "| Provider | Repository state | External/operator state |",
        "|---|---|---|",
    ]
    for provider, state in snapshot["providers"].items():
        lines.append(
            f"| {provider} | `{state.get('repo_status')}` | `{state.get('external_status')}` |"
        )
    lines.extend([
        "",
        "## Open launch blockers",
        "",
    ])
    live_states = snapshot.get("live_blocker_issue_states", {})
    for blocker in blockers:
        issue = blocker["issue"]
        live = live_states.get(str(issue), "not-checked")
        lines.append(
            f"- **{blocker['priority']} #{issue}** (`{live}`): {blocker['reason']}"
        )
    lines.extend([
        "",
        "## Truth boundary",
        "",
        "`SUCCESS` for repository CI is not evidence of a deployed production environment, live provider credentials, a real capacity run, a real restore from production backups, legal approval, or an independent penetration test. Those fields remain explicitly unverified until authoritative evidence is retained.",
        "",
    ])
    return "\n".join(lines)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--git-sha", required=True)
    parser.add_argument("--ref", default="local")
    parser.add_argument("--github-repo")
    parser.add_argument("--backend-image-identity")
    parser.add_argument("--eas-release-identity")
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--output-md", required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    snapshot = build_snapshot(
        evaluated_sha=args.git_sha,
        ref=args.ref,
        repo=args.github_repo,
        token=os.environ.get("GITHUB_TOKEN"),
        backend_image_identity=args.backend_image_identity,
        eas_release_identity=args.eas_release_identity,
    )
    output_json = Path(args.output_json)
    output_md = Path(args.output_md)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_md.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    output_md.write_text(render_markdown(snapshot), encoding="utf-8")
    print(
        "production readiness: "
        f"launch={snapshot['launch_decision']['status']} "
        f"main={snapshot['snapshot']['current_main_sha'] or 'unavailable'} "
        f"evaluated={snapshot['snapshot']['evaluated_git_sha']} "
        f"alembic={snapshot['repo_facts']['alembic_head']} "
        f"mobile={snapshot['repo_facts']['mobile_version']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
