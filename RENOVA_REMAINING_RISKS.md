# Remaining risks

- The current Stage Context uses data already present in `StageDetail` and project snapshots; dedicated per-kind stage endpoints are not yet exposed by the API, so unavailable entities are intentionally omitted rather than represented with fake counts.
- Playwright UI specs for the portal title and contract-gate banner expect strings absent from `main`; these should be updated in a separate test-maintenance change after product copy is agreed.
- The baseline still contains 117 pre-existing TypeScript errors outside this phase; no baseline increase or suppression was introduced.
- Bank imports with multiple payments sharing an amount still require date/description disambiguation; the API surfaces `date_match` so the user can review weaker matches before confirmation.
