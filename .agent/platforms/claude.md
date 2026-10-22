# Claude Code adapter

**Host application:** Claude Code. Activate only this platform adapter for the session, even if another model or tool is mentioned inside the task.

1. Treat root `CLAUDE.md` as the native bootstrap and `AGENTS.md` as the single engineering policy.
2. Read `.agent/kickoff.md`, `.agent/CONTINUATION-CURSOR.md`, then `.agent/skills/renova-product-engineering/SKILL.md`; load only the child skill needed for the task.
3. Respect `.claude/settings.json` permissions and deny rules. Do not write `.claude/**` from agent work unless repository policy is explicitly changed by the owner.
4. Use any Claude role agents only when they exist in the current authoritative branch and are relevant; do not treat an open PR as merged policy.
5. Resume work from GitHub branch/issue/PR/commit/check/review state, then read the latest valid `AGENT-CONTINUATION-CURSOR:v1` comment and reconcile it with the actual remote head before substantive work.
6. Continue from the cursor's first unfinished `next_action`; do not repeat `do_not_repeat` unless newer evidence invalidated it and never skip `must_not_skip`.
7. Before writes or push, refresh the remote branch head. If another client advanced it, stop stale writes, reread the diff/cursor, reconcile, and only then continue.
8. Before yielding to Cursor, Codex, or ChatGPT/GPT, create a durable checkpoint: coherent change + applicable focused validation + commit/push when policy allows + updated continuation cursor with the exact remote head. Do not represent uncommitted changes in an unshared checkout as transferred.

Do not activate `.agent/platforms/cursor.md`, `.agent/platforms/codex.md`, or `.agent/platforms/gpt.md` in the same Claude Code session.
