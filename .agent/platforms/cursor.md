# Cursor adapter

**Host application:** Cursor. Cursor remains the host even when its selected foundation model is Claude, GPT, or another provider model.

1. Treat `.cursor/rules/renova-agent-runtime.mdc` as the native bootstrap and `AGENTS.md` as the single engineering policy.
2. Read `.agent/kickoff.md`, then `.agent/skills/renova-product-engineering/SKILL.md`; load only the child skill needed for the task.
3. For mobile UI work, also obey `.cursor/rules/renova-design-system.mdc` and the current route/theme/component source of truth before generic UI guidance.
4. Do not infer Claude Code behavior from a Claude model selected inside Cursor; Cursor rules and this adapter remain active.
5. Resume from current GitHub branch/issue/PR/check/review state and refresh the branch head before writes when another client may have advanced it.

Do not activate `.agent/platforms/claude.md`, `.agent/platforms/codex.md`, or `.agent/platforms/gpt.md` in the same Cursor session.
