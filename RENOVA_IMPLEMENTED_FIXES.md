# Implemented fixes

- Added construction location resolver, reusable location line and graph integrity diagnostics.
- Added role-aware `StageContextSummary` with canonical navigation targets and one prioritized CTA.
- Added stage context domain tests and included them in `mobile:test`.
- Hardened document URL handling and push-link `returnTo` precedence.
- Kept Inbox as the attention source and restored plan-punch discovery.
- Removed profile “Ещё” duplication and migrated section menu typography to shared tokens.
- Payment filters use shared filter chips; expense detail actions now distinguish save, destructive delete and close.
- Bank statement matching retains a unique exact-amount payment when import date is outside the narrow confidence window and exposes `date_match` for review.
