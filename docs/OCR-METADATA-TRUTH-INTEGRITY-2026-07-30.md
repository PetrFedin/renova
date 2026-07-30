# OCR and document metadata truth integrity — 2026-07-30

## Problem

The previous `run_ocr_stub` never opened the uploaded file. It inspected only the document title, filename and MIME type, but then:

- set `ocr_status=done`;
- set `ocr_completed_at`;
- automatically changed the canonical `document_type` when confidence was at least 0.7;
- processed async queue rows without a transactional claim;
- started a background worker when `DOCUMENT_OCR_MODE=async`.

This made a filename heuristic look like completed content OCR and could silently move a document into the wrong type.

## Truthful modes

`DOCUMENT_OCR_MODE` now supports only:

- `metadata` — inspect title, filename and MIME type and create a non-authoritative suggestion;
- `off` — do not compute a suggestion and expose `ocr_status=unavailable`.

Legacy `sync`, `async`, `stub` and `demo` values fail startup. Unknown values also fail startup. The default is `metadata`.

## State contract

- `suggested`: metadata recommendation exists, file content was not read and confirmation is required;
- `confirmed`: an authenticated second request explicitly applied the already-visible metadata suggestion;
- `unavailable`: analysis is disabled or a real OCR engine is not configured;
- `failed`: metadata analysis failed safely;
- `done`: reserved for a future engine that actually reads document content.

The API representation includes:

- `source=metadata` for suggested/confirmed states;
- `content_read=false`;
- `engine_available=false`;
- `applied` and `requires_confirmation` flags.

## No automatic type transition

The first upload/analyse call always produces only `suggested`, even though the legacy upload route still passes `apply_type=true`.

A type changes only when a later authenticated POST sends `apply_type=true` while the current version is already in `suggested` state. This makes the transition explicit and reviewable without breaking the existing route.

## Worker integrity

The compatibility worker exists only to drain old queued metadata jobs:

- rows are claimed with `SELECT ... FOR UPDATE SKIP LOCKED` on PostgreSQL;
- claimed rows are moved to `processing` in the same transaction;
- a second worker skips locked rows;
- the result is `suggested`, never `done`;
- `document_type` is never changed by the worker.

The application lifecycle no longer starts an OCR background worker.

## Legacy repair

At startup, the idempotent repair:

- changes legacy `done` to `suggested` and marks it `legacy_metadata_classification_requires_review`;
- changes unfinished `queued/processing` rows to `unavailable`;
- clears fake job/completion fields.

The repair does not blindly revert an existing `document_type`, because the system cannot distinguish an old automatic change from a later manual edit. It instead marks the suggestion as requiring review.

## Tests

- `backend/tests/test_document_ocr_worker.py`
- `backend/tests/test_document_ocr_truth_integrity.py`

Both are part of the mandatory backend CI gate and cover metadata truth, off mode, two-step confirmation, worker replay, runtime validation and legacy repair.
