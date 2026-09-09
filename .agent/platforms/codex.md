# Codex adapter

**Host application:** Codex. `AGENTS.md` is the native repository entrypoint and remains the single engineering policy.

1. After `AGENTS.md`, read `.agent/kickoff.md`, then `.agent/skills/renova-product-engineering/SKILL.md`; load only the child skill needed for the task.
2. Treat repository files and current GitHub state as authoritative over a previous Codex thread or cached plan.
3. Resume an existing governed task from its branch/issue/PR/commits/checks/reviews instead of opening a duplicate branch because work moved from Claude, Cursor, or GPT.
4. Refresh the branch head before writes when another client may have advanced it, and preserve the current no-self-merge policy.

Do not activate `.agent/platforms/claude.md`, `.agent/platforms/cursor.md`, or `.agent/platforms/gpt.md` in the same Codex session.
