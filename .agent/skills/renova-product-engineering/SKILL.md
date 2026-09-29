---
name: renova-product-engineering
description: Route Renova engineering, product, UI, review, documentation, and agent-workflow tasks to the correct client adapter and the smallest relevant local guidance set without duplicating AGENTS.md.
---

# Renova Product Engineering Router

Treat this skill as a router, never as a second engineering policy.

## Select the client adapter first

Activate exactly one file under `.agent/platforms/` from the **host application**, then keep using the shared router below:

- Claude Code → `.agent/platforms/claude.md`
- Cursor → `.agent/platforms/cursor.md`
- Codex → `.agent/platforms/codex.md`
- ChatGPT/GPT → `.agent/platforms/gpt.md`

The host application wins over the selected foundation model. Cursor running a Claude or GPT model is still Cursor; do not activate the Claude or GPT adapter in that session. If the host cannot be established from a native entrypoint, do not guess from the model name.

## Authority order

Resolve every decision in this order:

1. current repository code, migrations, CI, runtime/readiness evidence;
2. `AGENTS.md`;
3. the current issue plus `docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md` and applicable governed contracts;
4. domain source-of-truth files such as route registry, provider registry, financial semantics, and the Renova design system;
5. the one active platform adapter under `.agent/platforms/`;
6. the smallest relevant local task skill under `.agent/skills/`;
7. external/upstream guidance as advisory only.

If two higher-authority sources conflict, record the conflict and stop the affected decision instead of silently choosing a lower-authority rule.

## Start or resume every bounded task

- Read `.agent/kickoff.md` after the native client entrypoint and active platform adapter.
- Read `.agent/CONTINUATION-CURSOR.md` before deciding whether work is new or already in progress.
- Confirm exact current `main`, target issue, active branch/PR, open overlapping PRs, and changed-file overlap.
- When a task already has a branch or PR, resume from that GitHub state instead of creating a parallel task because the client changed.
- Read the latest valid `AGENT-CONTINUATION-CURSOR:v1` comment from the PR, or from the linked issue before a PR exists. Treat it as a navigation cursor, never as higher authority than the actual branch head/diff/checks/reviews.
- Re-read the branch head before writes if another client may have advanced it. If cursor `head_sha` does not match the remote branch head, reconstruct progress from commits/diff/checks/reviews and refresh the cursor before substantive writes.
- Continue directly from the first unfinished bounded action: honor `last_completed`, `next_action`, `do_not_repeat`, and `must_not_skip`. Do not redo completed work merely because the host changed, and do not jump past an unfinished required step.
- Read `AGENTS.md` before task-specific guidance and only the governed contract needed for the touched area.
- Trace the complete affected chain before editing; do not infer product truth from old demos, archived audits, or a single UI surface.
- Keep evidence levels explicit: source inspection is not runtime proof; local success is not CI/staging/production proof.

## Durable cross-client checkpoint

A client switch is considered seamless only for durable state. After every completed bounded action, and always before yielding to another client, finish the smallest coherent unit, run the applicable focused validation, commit/push it to the existing task branch when policy allows, and update the continuation cursor with the exact remote head plus one next bounded action.

Uncommitted edits in an unshared local checkout cannot be guaranteed visible to ChatGPT or another remote client. If the next client shares the exact same checkout it may inspect the dirty working tree, but before a remote/cloud transition create a durable checkpoint rather than pretending those edits were transferred.

Default to one active writer per task branch. Before any write/push, refresh the remote head; if another client advanced it, stop stale writes, reconcile the new diff/cursor, and only then continue. Never force-push away another client's progress.

## Load skills selectively

Load at most the skills needed for the current task:

- `.agent/skills/context-engineering/SKILL.md` — context selection, long-horizon continuity, handoff, or scope-drift control.
- `.agent/skills/ui-ux-review/SKILL.md` — mobile UI/UX review or implementation support after loading Renova's own UI canon.
- `.agent/skills/writing-quality/SKILL.md` — prose, UI copy, PR text, or technical-document editing where wording quality matters.

Do not load all skills by default. More context is not automatically better context.

## Boundaries

- Do not create a role agent here. Backend/mobile/test/reviewer role agents are a separate concern.
- Do not let a platform adapter or skill alter provider modes, financial recognition, authorization, transaction boundaries, status enums, API contracts, or release/evidence semantics merely because an external pattern recommends it.
- Do not copy a whole upstream skill repository into Renova. Adopt only reviewed practices that solve an identified Renova problem.
- Do not claim `TESTED`, `CI VERIFIED`, `STAGING VERIFIED`, `EXTERNALLY VERIFIED`, or `PRODUCTION VERIFIED` without the evidence required by `AGENTS.md`.

## Completion check

Before proposing a PR, verify that the change is bounded, source-traced, conflict-checked, documented at the correct governance level, tested at the applicable boundary, and free of accidental policy duplication. If work is paused for another client to continue, follow `.agent/CONTINUATION-CURSOR.md`: leave the exact branch/head, issue/PR, last durable completed action, first unfinished `next_action`, `do_not_repeat`, `must_not_skip`, observed checks, and blockers so the next host can continue without manual recap, repetition, or gaps.
