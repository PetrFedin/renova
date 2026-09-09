# Claude Code adapter

**Host application:** Claude Code. Activate only this platform adapter for the session, even if another model or tool is mentioned inside the task.

1. Treat root `CLAUDE.md` as the native bootstrap and `AGENTS.md` as the single engineering policy.
2. Read `.agent/kickoff.md`, then `.agent/skills/renova-product-engineering/SKILL.md`; load only the child skill needed for the task.
3. Respect `.claude/settings.json` permissions and deny rules. Do not write `.claude/**` from agent work unless repository policy is explicitly changed by the owner.
4. Use any Claude role agents only when they exist in the current authoritative branch and are relevant; do not treat an open PR as merged policy.
5. Resume work from GitHub branch/issue/PR/check/review state. If the branch head moved since it was read, refresh before editing or pushing.

Do not activate `.agent/platforms/cursor.md`, `.agent/platforms/codex.md`, or `.agent/platforms/gpt.md` in the same Claude Code session.
