# Document Center — Wave 3 (plan + first slice)

**Дата:** 2026-07-15  
**Ветка:** `develop`

## Context

После Wave 2 (upload/restore/privacy) и инцидента `python-multipart`:

| Slice | Status | Notes |
|-------|--------|-------|
| Media nested paths `documents/{project_id}/file` | **done** | catch-all `/{file_path:path}` |
| Soft ACL: documents/* require X-User-Id | **done** | 401 without header |
| Full project membership check on media | planned | use require_project + storage_key ownership |
| Legal hold / retention | planned | status + admin flag |
| OCR / auto-classify upload | planned | async job |
| External e-sign | planned | provider after accreditation |
| Merge develop → main | gated | `MAIN-MERGE-CHECKLIST.md` |

## Acceptance for this slice

1. `GET /api/v1/media/documents/{project_id}/{file}` works (not 404 from route mismatch)
2. Without `X-User-Id` → 401
3. API boots with multipart installed (start-dev autodfix)

## Related

- `docs/INCIDENT-2026-07-15-API-MULTIPART.md`
- `docs/DOCUMENT-CENTER-WAVE2.md`

## Hotfix — storage presigned recursion

`presigned_url` ↔ `generate_cloudfront_signed_url` вызывали друг друга → `RecursionError` на GET media.
Исправлено: CloudFront helper возвращает `None` без CF config; S3 only when client exists; иначе local disk.
