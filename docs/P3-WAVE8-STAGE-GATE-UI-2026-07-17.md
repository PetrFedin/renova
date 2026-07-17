# P3-W8: Stage gate UI + contract auto-create hook

**Date:** 2026-07-17  
**Branch:** develop  
**Depends on:** P3-W7 contract gate (backend + portal)

## Done

### 1. Mobile contract gate UI (`StageDetailHero.tsx`)

When contractor taps **«Начать этап»** on a `planned` stage and API returns **403** with `code: contract_not_signed`:

- Alert **«Нужен договор»** with server message and pending document titles
- Button **«К документам»** → `/documents` (DocumentsHub for active project)

Uses existing `ApiError.detail` parsing from `lib/api/client.ts`.

### 2. Auto-create contract on estimate lock

**Skipped** — no estimate lock endpoint/feature in backend at this wave.

Searched: `lock_estimate`, `estimate_locked`, `is_locked`, freeze on estimate routes — not found.

**Future hook point:** when estimate lock is added, call `project_document_service.create_document(..., document_type=contract)` on lock if no contract exists.

## W7 (same commit, uncommitted prior)

- `project_contract_gate` in `project_document_service.py`
- Gate in `stage_service.start_stage` before dependency check
- `stages_ext.start_stage` → **403** for `contract_not_signed` (full detail dict)
- Kontur: duplicate flag in `esign.py`, `signing_url` in meta/portal
- `DocumentsHub` offline signing UI
- `portal.tsx` Kontur sign button

## Tests

```bash
cd backend && .venv/bin/python -m pytest tests/test_contract_gate.py tests/test_esign_providers.py tests/test_portal_sign.py -q
cd .. && npm run test:priority
```

## Next backlog (P3-W9+)

- Estimate lock + auto contract draft on lock
- Customer push when contract pending before stage start
- E2E: contractor blocked → documents → sign → start stage
