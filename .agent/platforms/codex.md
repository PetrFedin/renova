# Codex adapter

**Host application:** Codex. Codex discovers the repository through `.agents/skills/renova-product-engineering/SKILL.md`; root `AGENTS.md` remains the single engineering policy.

1. Read `AGENTS.md`, then `.agent/kickoff.md`, `.agent/CONTINUATION-CURSOR.md`, then the shared `.agent/skills/renova-product-engineering/SKILL.md`; load only the child skill needed for the task.
2. Treat repository files and current GitHub state as authoritative over a previous Codex thread or cached plan.
3. Resume an existing governed task from its branch/issue/PR/commits/checks/reviews, then read the latest valid `AGENT-CONTINUATION-CURSOR:v1` and reconcile its `head_sha` with the actual remote head.
4. Continue from `next_action`; do not repeat `do_not_repeat` unless newer evidence invalidated it and do not skip `must_not_skip`.
5. Refresh the remote branch head before writes/push when another client may have advanced it. Stop stale writes, reconcile new diff/cursor, and preserve the no-self-merge policy.
6. Before yielding to Claude Code, Cursor, or ChatGPT/GPT, create a durable checkpoint: coherent change + applicable focused validation + commit/push when policy allows + updated continuation cursor with the exact remote head. Uncommitted work in an unshared checkout is not considered handed off.

Do not activate `.agent/platforms/claude.md`, `.agent/platforms/cursor.md`, or `.agent/platforms/gpt.md` in the same Codex session.
