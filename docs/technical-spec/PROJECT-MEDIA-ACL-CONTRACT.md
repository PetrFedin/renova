# RENOVA project media ACL contract

Status: source contract for issue #449, bounded child of #375.

## 1. Problem boundary

Project mutations can reference binary evidence: stage photos, floor plans, QC/punch photos and design-package files. The database row and the referenced bytes are one security boundary. Authorizing only the row while serving the bytes outside project membership is not a valid RENOVA end-to-end result.

The legacy generic path minted `photos/<uuid>.jpg` after authentication only. Reads and presign enforced project membership for `documents/{project_id}/...` but not for `photos/*`; stage inline media could also live under `stages/*`. New project media must therefore carry project scope in the storage key itself.

## 2. Canonical namespace

New project-owned binary media uses:

```text
project-media/{project_id}/{opaque_file_name}.{extension}
```

Rules:

- `POST /api/v1/media/upload-url` requires `project_id`, `content_type` and optional original `filename`;
- the caller must have current project write authority before an upload intent is minted;
- the path project id is encoded into the storage key before any byte upload;
- MIME used to sign the PUT must equal the MIME sent by the client; PDF is not signed as JPEG;
- no metadata mutation may attach a canonical key whose encoded project id differs from the path project;
- no mutation may treat a storage key supplied by the client as proof of project membership.

## 3. Read / presign authority

For `project-media/{project_id}/...` both direct read and presign must:

1. parse the project id from the normalized key;
2. resolve the current authenticated user;
3. re-check current project read authority;
4. return privacy `404` when the project or authority is absent.

Existing `documents/{project_id}/...` remains governed by the document-media ACL contract.

Project-private media responses use private cache semantics. An authenticated upload alone never makes bytes public.

## 4. Legacy project media

Existing `photos/*` and `stages/*` are not public compatibility namespaces.

A legacy key is readable only when the database proves **exactly one** owning project through one of these existing references:

- `StagePhoto.storage_key` → `Stage.project_id`;
- `DesignPackage.file_key`;
- `FloorPlan.image_key`;
- `ProjectIssue.photo_key`.

Zero references or references from more than one project fail closed with privacy `404`. Once the single owner is resolved, current project read authority is required.

New attachment writes do not accept legacy unscoped keys. Compatibility is read-only for already persisted evidence.

## 5. Attachment-time binding

The following writers must reject a foreign canonical key before durable state changes:

- floor-plan create (`FloorPlan.image_key`);
- design-package create (`DesignPackage.file_key`);
- stage-photo create (`StagePhoto.storage_key`);
- QC/punch issue create (`ProjectIssue.photo_key`).

A user who legitimately has access to both project A and project B still cannot attach B media to an A mutation. This is object binding, not merely account ACL.

## 6. Mobile producer contract

The mobile upload helper receives `userId`, `projectId`, `Blob`, MIME and optional filename. It requests the project-scoped upload intent before PUT and reuses only the returned canonical key.

If no real upload transport exists, the helper fails closed with `ProjectMediaUploadUnavailable`; it must not return a key for bytes that were never persisted. Stage photos may use their explicit server-side inline/base64 fallback only for this typed transport-unavailable condition. Deterministic authorization/validation/network errors are not converted into an inline success.

Protected project media is rendered or downloaded with current authentication. Opening a design-package PDF uses the authenticated file-download path rather than an unauthenticated external `Linking.openURL` call.

## 7. Evidence required before close

#449 is not complete merely because these sources exist. Required evidence:

- backend focused tests for canonical mint/access, same-account cross-project attachment denial, positive same-project attachment and legacy fail-closed behavior;
- mobile source contract inside the standard `mobile:test` gate;
- mobile TypeScript integrity;
- full backend regression and existing document-media ACL regression;
- API/browser CI sufficient to show the changed surfaces still render without an auth regression.

Until those checks pass, status is `SOURCE REPAIRED / CI PENDING`, not `E2E VERIFIED`.

## 8. Out of scope

This contract does not claim security for every binary namespace. In particular, chat attachment storage uses a different `chat/*` namespace and must have its own participant/thread read authority contract rather than inheriting project-media rules accidentally.
