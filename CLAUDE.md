# Claude Code entrypoint for Renova

`AGENTS.md` is the single authoritative engineering instruction set for this repository. Read it before planning, editing, running migrations, changing runtime configuration, or reporting readiness.

For Claude Code, activate exactly one client adapter: `.agent/platforms/claude.md`. It routes into `.agent/kickoff.md` and the shared `renova-product-engineering` skill layer. Do not switch adapters based on the selected foundation model or on a model name mentioned in the task.

This file intentionally does **not** duplicate Renova architecture, transaction, security, Git, or release rules. If any historical document, old branch, local snapshot, or tool-generated suggestion conflicts with `AGENTS.md`, current code, current CI, or `PRODUCTION-READINESS.md`, use the newer authoritative source.

For local development use the existing root dispatcher:

```bash
npm run dev -- doctor
npm run dev -- bootstrap   # explicit dependency installation; not part of startup
npm run dev                # full local topology + Expo
npm run dev -- check
npm run dev -- test-focused
npm run dev -- test-full
npm run dev -- stop
```

For non-interactive backend-only verification:

```bash
RENOVA_DEV_NO_EXPO=1 npm run dev
npm run dev -- check
npm run dev -- test-focused
```

`env.local.example` / `.env.local` are local-development only. Never load staging/production env examples into the canonical local runtime and never report local success as staging/production evidence.
