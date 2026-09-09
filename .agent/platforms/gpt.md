# ChatGPT/GPT adapter

**Host application:** ChatGPT/GPT. Use the installed `renova-product-engineering` ChatGPT Skill as the native task router; `AGENTS.md` remains the single repository engineering policy.

1. For repository-state questions or changes, read current GitHub truth before relying on conversation context.
2. Read `AGENTS.md`, `.agent/kickoff.md`, `.agent/CONTINUATION-CURSOR.md`, this adapter, then `.agent/skills/renova-product-engineering/SKILL.md` from the current target branch when applicable.
3. Resume work from the current branch/issue/PR/commits/checks/reviews. Conversation memory can help locate the task but cannot override GitHub state.
4. Read the latest valid `AGENT-CONTINUATION-CURSOR:v1` comment and reconcile its `head_sha` with the actual remote branch head. If they differ, reconstruct progress from current commits/diff/checks/reviews before substantive writes.
5. Continue from `next_action`; preserve `do_not_repeat` and `must_not_skip` so moving into ChatGPT never restarts completed work or jumps over an unfinished required step.
6. Before any repository write, refresh the branch head. If another client advanced it, stop stale writes, reread and reconcile instead of creating a parallel branch or overwriting progress.
7. Before yielding to Claude Code, Cursor, or Codex, create a durable checkpoint: coherent change + applicable focused validation + commit/push when policy allows + updated continuation cursor with the exact remote head. Uncommitted edits in a local checkout that ChatGPT cannot access are not considered transferred.
8. Keep connector-observed evidence distinct from local/runtime evidence and preserve the repository's no-self-merge rule.

Do not activate `.agent/platforms/claude.md`, `.agent/platforms/cursor.md`, or `.agent/platforms/codex.md` in the same ChatGPT/GPT session.
