---
name: ui-ux-review
description: Review or support implementation of Renova mobile UI and UX without overriding the repository design system. Use for screens, navigation, forms, states, accessibility, user flows, information hierarchy, or UI-copy decisions under apps/mobile.
---

# Renova UI/UX Review

External design heuristics are advisory. Renova's current UI canon wins.

## Load the canon first

Before recommending or editing UI, inspect:

- `AGENTS.md` mobile/UI rules;
- `.cursor/rules/renova-design-system.mdc`;
- `apps/mobile/lib/routeRegistry.ts` and current navigation implementation;
- the actual theme/tokens and `components/ui` primitives used by the touched screen;
- the API/client contract that supplies the screen state.

Do not resurrect archived navigation, duplicate hubs, raw local design tokens, or a second component system.

## Review the complete user outcome

Check, where applicable:

- the screen is reachable through canonical navigation and deeplinks restore authorized context;
- one clear primary next action is visible rather than competing primary CTAs;
- loading, empty, error, stale/offline, processing/queued, conflict, access-revoked, and committed-success states are honest and distinguishable where the domain can produce them;
- destructive, financial, approval, and acceptance actions fail closed and communicate the resulting state;
- labels and controls are understandable in Russian product language and do not expose raw developer/provider errors;
- accessibility labels, text scaling, contrast, focus/keyboard behavior, and touch targets follow current repository rules;
- badges, totals, money, schedule, and status labels have one defined source and match their drill-down view;
- the UI uses existing tokens/components before any new primitive is proposed.

## Recommendation discipline

Classify a UI recommendation as one of:

- **required by Renova canon** — directly supported by current repository policy/source;
- **defect** — current implementation breaks a governed contract or user path;
- **advisory improvement** — useful external heuristic with no current canonical requirement.

Never present an advisory pattern as a repository requirement. Do not rewrite the visual language merely to match a generic design trend.
