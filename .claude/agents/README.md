# Claude Code subagents for Renova

Each file here defines a specialised agent with its own system prompt, tool set and
context window. Claude Code picks one automatically when the task matches its
`description`, or you can name it:

```
> use backend-dev to add the participant scope check
> ask test-runner to prove GP3 end to end
> have reviewer look at this PR
```

| Agent | Purpose |
|---|---|
| `backend-dev` | FastAPI, services, outbox, Alembic, pytest |
| `mobile-dev` | Expo / React Native under `apps/mobile`, typecheck, reachable screens |
| `test-runner` | Local topology, backend suites, Playwright golden paths, honest evidence |
| `reviewer` | Independent second reader per mandate §7; APPROVE or CHANGES_REQUESTED |

## Boundaries

`../settings.json` is the enforceable boundary: agents work on `agent/*` branches,
cannot push to `main`, cannot merge, cannot edit `.github/workflows/**` or
`.claude/**`, cannot read `.env*`, and cannot edit applied Alembic revisions.

The reviewer agent mirrors the automated second-agent review in
`.github/workflows/claude-agent.yml`, so a change can be reviewed locally before it
reaches CI. Merging remains the owner's decision after CI is green.

## Related documents

- `AGENTS.md` — authoritative engineering instruction set
- `docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md` — priorities and Definition of Done
- `docs/technical-spec/GOLDEN-PATHS.md` — the sequences that define functional completeness
- `PRODUCTION-READINESS.md` — what is and is not proven
