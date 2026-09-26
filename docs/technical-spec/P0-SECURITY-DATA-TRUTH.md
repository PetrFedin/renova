# P0 Security / data truth — authorization binding

Status: **candidate implementation in #375; not complete until required CI and review are green**.

This annex is governed by `AGENTS.md` and the Product Completion Mandate. It does not change the planned product surface. It narrows the authorization contract for existing estimate and project-media flows.

## 1. Estimate-line mutation

For `PATCH /projects/{project_id}/estimate/lines/{line_id}` authorization is a property of the pair `(project_id, line_id)`, not of either identifier independently.

Required invariant:

`EstimateLine.project_id == project_id` must be proven before any mutation or commit.

A caller who can write project A but supplies a line from project B receives privacy `404`; project B remains byte-for-byte unchanged by that request. A same-project line remains editable subject to the existing role and estimate-lock gates.

## 2. Project media

Opaque UUID filenames are not an access-control mechanism.

Canonical new keys use the namespace:

- `projects/{project_id}/uploads/{object}`
- `projects/{project_id}/stages/{stage_id}/photos/{object}`

The upload-intent endpoint must prove current project write access before issuing such a key. A stage key additionally proves `Stage.project_id == project_id`.

Legacy project-media keys remain readable only when the backend can resolve them through an authoritative owning entity (`StagePhoto`, `DesignPackage`, `FloorPlan`, `ProjectIssue`) to exactly one project. Unknown, unattached or ambiguously cross-project keys fail closed.

Direct GET/presign requires current project read access and returns privacy `404` for an unrelated account. Active technical supervision retains the existing read-only project fallback; generic project-media writes do not gain that fallback.

Visible contractor portfolio media is a separate intentionally public media class and is not treated as project media.

## 3. UI delivery contract

Native/web image components must not embed long-lived JWT credentials in URLs and must not rely on public project-media endpoints.

The client first performs an authenticated project read, then requests a short-lived media capability. The capability is HMAC-signed, bound to one normalized storage key, and valid for at most 15 minutes; the current implementation mints a five-minute URL. Expired or modified capabilities are invalid.

Capability refresh is a secondary reconciliation step: failure to refresh media must not turn an otherwise valid cached project/stage response into a false mutation or screen-level success/failure transition.

## 4. Acceptance evidence for #375

Required before merge:

- cross-project estimate-line PATCH -> `404`, foreign line unchanged;
- same-project estimate-line PATCH remains green;
- legacy stage-photo key resolves to its project;
- unrelated project user cannot obtain a media capability;
- project-bound upload intent rejects an unrelated user;
- unknown/unattached opaque media key fails closed;
- backend suite, mobile type/contracts, PostgreSQL migration check and required CI are green;
- no regression in existing document-media ACL behavior.

This annex must not be interpreted as Golden Path completion. GP1–GP8 and G04/G05 remain governed by their separate acceptance documents until their full API + mobile-web scenarios are green on the canonical PostgreSQL/Redis/MinIO/API/Worker runtime.

## 5. Findings deliberately kept outside #375

The path scan found two additional bounded defects and recorded them rather than silently expanding this change:

- `#376` — S3/MinIO presigned PUT currently signs `image/jpeg` even when the caller uploads another content type such as a design PDF; this requires an explicit Content-Type upload contract.
- `#377` — floor-plan pin mutation / furniture references need the same parent-project binding discipline.
