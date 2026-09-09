# ChatGPT/GPT adapter

**Host application:** ChatGPT/GPT. Use the installed `renova-product-engineering` ChatGPT Skill as the native task router; `AGENTS.md` remains the single repository engineering policy.

1. For repository-state questions or changes, read current GitHub truth before relying on conversation context.
2. Read `AGENTS.md`, `.agent/kickoff.md`, this adapter, then `.agent/skills/renova-product-engineering/SKILL.md` from the current target branch when applicable.
3. Resume work from the current branch/issue/PR/commits/checks/reviews. Conversation memory can help locate the task but cannot override GitHub state.
4. If the head SHA changed after it was read, refresh the diff/checks before any write. Do not create a parallel branch merely because the task moved into ChatGPT.
5. Keep connector-observed evidence distinct from local/runtime evidence and preserve the repository's no-self-merge rule.

Do not activate `.agent/platforms/claude.md`, `.agent/platforms/cursor.md`, or `.agent/platforms/codex.md` in the same ChatGPT/GPT session.
