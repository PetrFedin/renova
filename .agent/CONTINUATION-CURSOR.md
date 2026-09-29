# Renova cross-client continuation cursor

This protocol makes Claude Code, Cursor, Codex, and ChatGPT/GPT continue one governed task instead of restarting it or skipping unfinished work. It is navigation state only; repository/GitHub truth remains authoritative.

## Canonical state order

When resuming a task, reconstruct state in this order:

1. actual active branch and exact remote head SHA;
2. current diff/commits and any visible working-tree changes in the current checkout;
3. linked issue acceptance criteria and current PR;
4. current checks, reviews, blockers, and retained evidence;
5. the latest valid continuation cursor comment;
6. conversation memory only as a locator, never as project truth.

A continuation cursor never overrides a newer branch head, failing check, review, user instruction, or governed contract.

## Durable checkpoint rule

Cross-client continuity is guaranteed only for durable state. After every completed bounded action, and always before yielding work to another client:

1. finish the smallest coherent unit of work;
2. run the applicable focused validation for that unit;
3. commit and push the coherent change to the existing task branch when repository policy allows it;
4. update the continuation cursor with the exact remote head SHA and the next bounded action.

If work is still only an uncommitted local edit, a remote/cloud client cannot reliably see it. A client sharing the exact same local checkout may inspect the dirty working tree, but switching to a client that does not share that checkout must wait for a durable checkpoint. Never claim seamless handoff across an unshared checkout for uncommitted work.

## Cursor location

- If a PR exists, keep one top-level PR Conversation comment whose first marker is `AGENT-CONTINUATION-CURSOR:v1` and update that comment in place when possible.
- Before a PR exists, use the linked issue conversation with the same marker.
- If tool limitations create more than one cursor comment, use the newest comment whose `head_sha` can be reconciled to the active branch, then consolidate on the next update.

Recommended body:

```text
AGENT-CONTINUATION-CURSOR:v1
status: ACTIVE | PAUSED | BLOCKED | READY_FOR_REVIEW
task: #<issue>
pr: #<pr-or-none>
branch: <branch>
head_sha: <40-char remote SHA>
last_client: claude | cursor | codex | gpt
last_completed: <last action that is actually durable and evidenced>
next_action: <single next bounded action>
do_not_repeat: <completed actions that must not be redone unless invalidated>
must_not_skip: <first unfinished acceptance/test/review step that must happen before later work>
checks_observed: <only checks actually observed, with status/run when useful>
blockers: <current blocker or none>
notes: <only context needed to continue safely>
```

## Resume algorithm

At the beginning of every client session:

1. select the adapter by host application, not by foundation-model name;
2. identify the matching issue/branch/PR before creating anything new;
3. fetch the current remote branch head and read the latest cursor;
4. compare `head_sha` with the actual remote head;
5. if they differ, treat the cursor as stale, reconstruct progress from commits/diff/checks/reviews, and refresh the cursor before substantive writes;
6. verify `last_completed` is present in durable repository/evidence state;
7. verify `next_action` is the first unfinished bounded action consistent with the issue acceptance criteria;
8. honor `do_not_repeat` and `must_not_skip`;
9. continue directly with `next_action`.

A completed action may be repeated only when it was invalidated by a newer head, a failing check/review, a changed user requirement, or stale/incorrect evidence. Record the reason in the cursor instead of silently redoing work.

## No-gap rule

Before advancing beyond `next_action`, compare the issue/PR acceptance checklist and relevant plan against durable evidence. If an earlier required step is unfinished, place it in `must_not_skip` and perform it first. Do not jump to a later implementation/review/release step merely because a different client is now active.

## Concurrency and stale-writer protection

Renova assumes one active writer per task branch unless the owner explicitly coordinates parallel work. Before every write/push, refresh the remote head. If another client advanced the branch, stop stale writes, read the new diff and cursor, reconcile, then continue. Do not force-push to erase another client's progress.

## Handoff result

A successful client switch should require no manual recap from the user: the next client identifies the same task, validates the current head, reads what is already completed, performs the first unfinished action, and preserves all newer work.