#!/usr/bin/env python3
"""Fail closed when a globally-required PR check can disappear.

`main-protection` requires a fixed set of status contexts on every pull request.
If any owning workflow becomes path-filtered, loses its pull_request trigger, or
renames the required job context, GitHub can permanently block otherwise-valid
PRs because the required check-run is never created.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

EXPECTED_REQUIRED_CONTEXTS = (
    "mobile-contracts",
    "chat-message-contracts",
    "project-creation-contracts",
    "acceptance-decision-contracts",
    "stage-mutation-contracts",
    "team-lifecycle-contracts",
    "backend-complete",
    "playwright-api-and-ui",
    "source-and-runtime",
    "security-source-contract",
    "typecheck-integrity",
    "snapshot",
    "policy",
)

WORKFLOW_CONTEXTS: dict[Path, tuple[str, ...]] = {
    Path(".github/workflows/ci.yml"): (
        "mobile-contracts",
        "chat-message-contracts",
        "project-creation-contracts",
        "acceptance-decision-contracts",
        "stage-mutation-contracts",
        "team-lifecycle-contracts",
        "backend-complete",
        "playwright-api-and-ui",
    ),
    Path(".github/workflows/local-runtime-integrity.yml"): ("source-and-runtime",),
    Path(".github/workflows/security-operations.yml"): ("security-source-contract",),
    Path(".github/workflows/mobile-typecheck-fail-closed-integrity.yml"): ("typecheck-integrity",),
    Path(".github/workflows/production-readiness-integrity.yml"): ("snapshot",),
    Path(".github/workflows/agent-pr-policy.yml"): ("policy",),
}

SETUP_SCRIPT = Path("scripts/governance/setup-github.sh")
_PATH_FILTER_RE = re.compile(r"^\s{4}(paths|paths-ignore):(?:\s|$)")
_JOB_RE = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
_JOB_NAME_RE = re.compile(r"^    name:\s*(.+?)\s*$")


def _strip_yaml_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _pull_request_trigger_error(text: str) -> str | None:
    lines = text.splitlines()
    on_index = None
    on_line = None
    for index, line in enumerate(lines):
        if re.match(r"^on:\s*", line):
            on_index = index
            on_line = line
            break
    if on_index is None or on_line is None:
        return "missing top-level on trigger"

    inline = on_line.partition(":")[2].strip()
    if inline:
        if "pull_request" not in inline:
            return "missing pull_request trigger"
        if re.search(r"\bpaths(?:-ignore)?\b", inline):
            return "inline pull_request trigger contains a path filter"
        return None

    pr_index = None
    pr_line = None
    for index in range(on_index + 1, len(lines)):
        line = lines[index]
        if line and not line.startswith(" "):
            break
        if re.match(r"^  pull_request:\s*", line):
            pr_index = index
            pr_line = line
            break
    if pr_index is None or pr_line is None:
        return "missing pull_request trigger"

    inline_pr = pr_line.partition(":")[2].strip()
    if inline_pr and re.search(r"\bpaths(?:-ignore)?\b", inline_pr):
        return "inline pull_request trigger contains a path filter"

    for line in lines[pr_index + 1 :]:
        if line and len(line) - len(line.lstrip(" ")) <= 2:
            break
        match = _PATH_FILTER_RE.match(line)
        if match:
            return f"pull_request trigger is filtered by {match.group(1)}"
    return None


def _job_contexts(text: str) -> set[str]:
    lines = text.splitlines()
    jobs_index = None
    for index, line in enumerate(lines):
        if line.strip() == "jobs:" and not line.startswith(" "):
            jobs_index = index
            break
    if jobs_index is None:
        return set()

    contexts: set[str] = set()
    current_job: str | None = None
    for line in lines[jobs_index + 1 :]:
        if line and not line.startswith(" "):
            break
        job_match = _JOB_RE.match(line)
        if job_match:
            current_job = job_match.group(1)
            contexts.add(current_job)
            continue
        if current_job:
            name_match = _JOB_NAME_RE.match(line)
            if name_match:
                contexts.add(_strip_yaml_scalar(name_match.group(1)))
    return contexts


def _configured_contexts_from_setup(text: str) -> tuple[str, ...]:
    return tuple(re.findall(r'\{\s*"context"\s*:\s*"([^"]+)"\s*\}', text))


def _self_test() -> None:
    trigger_fixtures = {
        "compact": ("on: [push, pull_request]\njobs:\n  x:\n", None),
        "unconditional": ("on:\n  pull_request:\n  push:\n    branches: [main]\n", None),
        "types-only": ("on:\n  pull_request:\n    types: [opened, synchronize]\n", None),
        "paths": (
            "on:\n  pull_request:\n    paths:\n      - 'backend/**'\n",
            "pull_request trigger is filtered by paths",
        ),
        "paths-ignore": (
            "on:\n  pull_request:\n    paths-ignore:\n      - 'docs/**'\n",
            "pull_request trigger is filtered by paths-ignore",
        ),
        "inline-paths": (
            "on:\n  pull_request: { paths: ['backend/**'] }\n",
            "inline pull_request trigger contains a path filter",
        ),
        "missing": ("on:\n  push:\n    branches: [main]\n", "missing pull_request trigger"),
    }
    for name, (text, expected) in trigger_fixtures.items():
        actual = _pull_request_trigger_error(text)
        if actual != expected:
            raise AssertionError(f"trigger self-test {name}: expected {expected!r}, got {actual!r}")

    contexts = _job_contexts(
        "jobs:\n"
        "  source-contract:\n"
        "    name: security-source-contract\n"
        "    runs-on: ubuntu-latest\n"
        "  policy:\n"
        "    runs-on: ubuntu-latest\n"
    )
    expected_contexts = {"source-contract", "security-source-contract", "policy"}
    if contexts != expected_contexts:
        raise AssertionError(f"job-context self-test: expected {expected_contexts!r}, got {contexts!r}")


def main() -> int:
    _self_test()
    failures: list[str] = []

    if not SETUP_SCRIPT.is_file():
        failures.append(f"missing governance source {SETUP_SCRIPT}")
    else:
        configured = _configured_contexts_from_setup(SETUP_SCRIPT.read_text(encoding="utf-8"))
        if configured != EXPECTED_REQUIRED_CONTEXTS:
            failures.append(
                "checked-in main-protection required contexts drifted: "
                f"expected {EXPECTED_REQUIRED_CONTEXTS!r}, found {configured!r}"
            )

    covered: list[str] = []
    for path, required_contexts in WORKFLOW_CONTEXTS.items():
        if not path.is_file():
            failures.append(f"missing required workflow {path}")
            continue

        text = path.read_text(encoding="utf-8")
        trigger_error = _pull_request_trigger_error(text)
        if trigger_error:
            failures.append(f"{path}: {trigger_error}")

        actual_contexts = _job_contexts(text)
        for context in required_contexts:
            covered.append(context)
            if context not in actual_contexts:
                failures.append(f"{path}: required context {context!r} is not produced by any job id/name")

    if tuple(covered) != EXPECTED_REQUIRED_CONTEXTS:
        failures.append(
            "workflow coverage drifted: "
            f"expected {EXPECTED_REQUIRED_CONTEXTS!r}, mapped {tuple(covered)!r}"
        )

    if failures:
        for failure in failures:
            print(f"ERROR: {failure}", file=sys.stderr)
        return 1

    for path, contexts in WORKFLOW_CONTEXTS.items():
        print(f"required PR trigger OK: {', '.join(contexts)} <- {path}")
    print(f"required-context source OK: {SETUP_SCRIPT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
