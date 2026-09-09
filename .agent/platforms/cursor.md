# Cursor adapter

**Host application:** Cursor. Cursor remains the host even when its selected foundation model is Claude, GPT, or another provider model.

1. Treat `.cursor/rules/renova-agent-runtime.mdc` as the native bootstrap and `AGENTS.md` as the single engineering policy.
2. Read `.agent/kickoff.md`, `.agent/CONTINUATION-CURSOR.md`, then `.agent/skills/renova-product-engineering/SKILL.md`; load only the child skill needed for the task.
3. For mobile UI work, also obey `.cursor/rules/renova-design-system.mdc` and the current route/theme/component source of truth before generic UI guidance.
4. Do not infer Claude Code behavior from a Claude model selected inside Cursor; Cursor rules and this adapter remain active.
5. Resume from current GitHub branch/issue/PR/commit/check/review state, then read the latest valid `AGENT-CONTINUATION-CURSOR:v1` comment and reconcile it with the actual remote head.
6. Continue from `next_action`; preserve `do_not_repeat` and `must_not_skip` so changing the model or moving into Cursor never causes duplicated work or skipped acceptance steps.
7. Before writes or push, refresh the remote branch head. If another client advanced it, stop stale writes, reread the diff/cursor, reconcile, then continue.
8. Before yielding to Claude Code, Codex, or ChatGPT/GPT, create a durable checkpoint: coherent change + applicable focused validation + commit/push when policy allows + updated continuation cursor with the exact remote head. Uncommitted edits in an unshared checkout are not a transferable checkpoint.

Do not activate `.agent/platforms/claude.md`, `.agent/platforms/codex.md`, or `.agent/platforms/gpt.md` in the same Cursor session.
