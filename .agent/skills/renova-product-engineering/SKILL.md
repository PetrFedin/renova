---
name: renova-product-engineering
description: Route Renova engineering, product, UI, review, documentation, and agent-workflow tasks to the smallest relevant local guidance set. Use for work in PetrFedin/renova when an agent needs to plan, implement, review, or explain a change without duplicating AGENTS.md or loading every available skill.
---

# Renova Product Engineering Router

Treat this skill as a router, never as a second engineering policy.

## Authority order

Resolve every decision in this order:

1. current repository code, migrations, CI, runtime/readiness evidence;
2. `AGENTS.md`;
3. the current issue plus `docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md` and applicable governed contracts;
4. domain source-of-truth files such as route registry, provider registry, financial semantics, and the Renova design system;
5. the smallest relevant local task skill under `.agent/skills/`;
6. external/upstream guidance as advisory only.

If two higher-authority sources conflict, record the conflict and stop the affected decision instead of silently choosing a lower-authority rule.

## Start every bounded task

- Confirm the exact current `main`, target issue, open overlapping PRs, and changed-file overlap.
- Read `AGENTS.md` before task-specific guidance.
- Read only the governed contract needed for the touched area.
- Trace the complete affected chain before editing; do not infer product truth from old demos, archived audits, or a single UI surface.
- Keep evidence levels explicit: source inspection is not runtime proof; local success is not CI/staging/production proof.

## Load skills selectively

Load at most the skills needed for the current task:

- `.agent/skills/context-engineering/SKILL.md` — context selection, long-horizon continuity, handoff, or scope-drift control.
- `.agent/skills/ui-ux-review/SKILL.md` — mobile UI/UX review or implementation support after loading Renova's own UI canon.
- `.agent/skills/writing-quality/SKILL.md` — prose, UI copy, PR text, or technical-document editing where wording quality matters.

Do not load all skills by default. More context is not automatically better context.

## Boundaries

- Do not create a role agent here. Backend/mobile/test/reviewer role agents are a separate concern.
- Do not let a skill alter provider modes, financial recognition, authorization, transaction boundaries, status enums, API contracts, or release/evidence semantics merely because an external pattern recommends it.
- Do not copy a whole upstream skill repository into Renova. Adopt only reviewed practices that solve an identified Renova problem.
- Do not claim `TESTED`, `CI VERIFIED`, `STAGING VERIFIED`, `EXTERNALLY VERIFIED`, or `PRODUCTION VERIFIED` without the evidence required by `AGENTS.md`.

## Completion check

Before proposing a PR, verify that the change is bounded, source-traced, conflict-checked, documented at the correct governance level, tested at the applicable boundary, and free of accidental policy duplication.
