---
name: context-engineering
description: Build a minimal, authoritative working context for complex Renova tasks. Use when a task spans many files or turns, has competing sources of truth, needs an agent handoff, risks scope drift, or requires selecting evidence without flooding the context window.
---

# Context Engineering for Renova

Use context as a controlled working set, not as a repository dump.

## Build the working set

1. State the exact task, issue, branch, acceptance criteria, and evidence boundary.
2. Load `AGENTS.md` and the current task/contract before historical material.
3. Add only files that are necessary to trace the touched end-to-end path.
4. Separate facts into:
   - authoritative current source;
   - current test/CI evidence;
   - unresolved finding;
   - historical/reference material.
5. Remove context that no longer changes a decision or supports evidence.

## Prevent context drift

- Prefer current code and exact-SHA evidence over summaries from earlier chats or old audit snapshots.
- Preserve identifiers, state names, issue IDs, branch names, exact commands, and evidence levels verbatim when they are contractual.
- Re-check current `main`, open PRs, and the relevant contract before a long-running task resumes after an interruption.
- If a new discovery changes scope materially, record it as a separate issue unless the governing contract explicitly requires it in the current slice.

## Handoff packet

For an agent handoff, keep the packet small and explicit:

- goal and non-goals;
- exact base/head SHA and branch;
- authoritative files already checked;
- changed files;
- decisions made and their source;
- tests/evidence actually observed;
- unresolved blockers and next safe action.

Do not include large transcripts when the same information can be represented by exact file paths, SHAs, findings, and commands.

## Multi-agent boundary

Use subagents to isolate specialist work or independent review, not to create multiple competing sources of truth. A handoff is incomplete if the receiving agent must guess the authority order or evidence state.
