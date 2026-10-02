# Renova — Integration Master Plan

**Document:** `docs/RENOVA_INTEGRATION_MASTER_PLAN_2026-10-01.md`  
**Status:** PLANNED  
**Date:** 2026-10-01  
**Repository:** `PetrFedin/renova`

## Purpose

This file is the canonical integration roadmap for strengthening Renova without replacing its existing authorities. A future instruction to implement this document means executing the phases below in order, preserving the current Project/Works/Budget/Acceptance/Payments/Documents authorities.

This roadmap is not evidence that listed capabilities are already live.

## Baseline that must remain authoritative

Renova already has a strong mobile + API core, offline queue, project lifecycle, acceptance, payment lifecycle, document OCR, e-sign provider boundaries, notifications, audit/event patterns and extensive mobile/E2E coverage.

Therefore this plan does **not** introduce a second project-management system, a second document source of truth or a second payment authority.

## Integration decisions

| Capability | External source | Decision | Boundary |
|---|---|---|---|
| Digital Site Diary | native Renova domain | ADOPT | Renova-owned daily execution record |
| Plan/photo markup | Shopify React Native Skia | ADOPT | UI/capture only |
| Resumable evidence upload | tus-js-client + tusd | ADOPT/SIDECAR | upload transport only |
| Drawing/PDF review | PDF.js | ADOPT | viewer only |
| Before/after alignment | OpenCV | ADAPT | worker-derived evidence |
| Trusted media provenance | C2PA | ADAPT | evidence metadata, not business authority |
| 360 progress views | Pannellum | ADOPT | presentation layer |
| Punch/Hold Point model | native | ADOPT | execution authority |
| Change Impact Engine | Timefold patterns | ADAPT | planning/simulation only |
| BIM/IFC | web-ifc | DEFER/ADAPT | read/extract model context |
| Collaborative sketching | Excalidraw patterns | ADAPT | annotation surface |
| E-sign | Documenso patterns/provider | ADAPT | current Renova signing authority remains |
| Document archive patterns | Paperless | REFERENCE | OCR already exists in Renova |
| Supplier/contractor CRM patterns | Twenty | REFERENCE/ADAPT | scorecard native in Renova |
| Invoice patterns | Invoice Ninja | REFERENCE | payments/invoices remain Renova |
| Asset/tool registry | Snipe-IT patterns | REFERENCE | only if equipment control enters scope |
| Portfolio PM | OpenProject patterns | REFERENCE | do not replace Renova project authority |
| Large-list performance | FlashList | ADOPT | mobile rendering only |

## Phase 0 — Preserve current Golden Path

Before new integrations:

1. Keep the existing project lifecycle and payment/acceptance golden paths green.
2. Confirm PostgreSQL is authoritative in deployed environments.
3. Keep outbox/audit/event behavior intact.
4. Add migration + API + mobile contract tests for every new execution entity.

No feature below may bypass current project ACL or team access checks.

## Phase 1 — Digital Site Diary

Create native entities:

- site_day;
- work_log;
- workforce_log;
- material_delivery;
- blocker;
- weather/context note where relevant;
- evidence_attachment;
- responsible contractor/team.

Flow:

`project -> room/work package -> site day -> work performed -> evidence -> issue/hold point -> acceptance`

The diary must be generated from real project/work IDs, not free-floating notes.

### Acceptance

- one project-day has one canonical diary;
- entries are append/audit safe;
- contractor/customer visibility follows ACL;
- evidence links are immutable references;
- daily summary can be exported but export is not authority.

## Phase 2 — Punch List + Hold Points

Strengthen current acceptance/punch functionality into structured execution control.

Add:

- defect/punch item;
- severity;
- location/room/work package;
- responsible party;
- due date;
- hold-point flag;
- required evidence;
- reinspection;
- closed/accepted state.

A hold point blocks the configured next work/payment milestone until explicitly released by an authorised role.

Do not duplicate existing Acceptance entities. Punch/Hold Point must reference and feed the current acceptance canon.

## Phase 3 — Evidence Capture UX

### React Native Skia

Use for:

- draw defect polygon/arrow/text on photo;
- mark plan area;
- dimension/measurement annotation;
- compare markup revisions.

Store annotation geometry separately from the source image so the original stays immutable.

### tus upload

Use resumable upload for:

- long site videos;
- 360 captures;
- high-resolution evidence packs.

Flow:

`create upload intent -> resumable transport -> checksum -> quarantine -> object storage -> evidence admitted`

A completed upload is not accepted evidence until server checksum/ACL/admission succeeds.

### FlashList

Use only where long lists materially improve mobile performance: expenses, evidence, messages, materials, work packages.

## Phase 4 — Trusted Photo / Before-After Evidence

### OpenCV worker

Derive:

- image alignment;
- common viewpoint estimate;
- crop/registration suggestion;
- visual-difference preview.

Never auto-declare a defect fixed from CV output.

### C2PA

Where supported, persist content credentials/provenance metadata for captured or imported media. C2PA proves provenance statements, not that the construction work is correct.

### 360 / Pannellum

Attach panorama to room + date + work package. Timeline view should allow switching between captures from the same room.

Order: normal photo evidence first -> stable storage/checksum -> 360 second.

## Phase 5 — Documents, Drawings and BIM

### PDF.js

Embed project drawings/contracts/specifications with:

- page deep links;
- referenced comments;
- issue-to-page anchors;
- search/highlight.

### Excalidraw patterns

Use as a bounded sketch/annotation mode. Exported sketch stores structured source + rendered preview, linked to project/work package.

### web-ifc

Only after ordinary plan/PDF workflows are stable.

Use IFC as contextual read model:

`IFC element -> room/system/component -> Renova work package/issue/evidence`

Do not make IFC the source of project financial or acceptance state.

### Paperless

Reference taxonomy/retention/document UX only. Do not introduce a second OCR/archive authority because Renova already has OCR/document handling.

## Phase 6 — Change Impact Engine

Reference: Timefold optimisation patterns.

Trigger:

`change request -> affected work packages/materials/resources -> delta cost -> delta time -> conflicts -> approval`

Outputs are proposals:

- Δ budget;
- Δ schedule;
- material consequences;
- dependent milestones;
- suggested rescheduling.

The optimiser must never commit schedule/payment changes itself. Human approval writes the canonical change.

## Phase 7 — Contractor & Supplier Performance

Implement native scorecards using existing Renova facts:

- on-time completion;
- defects/rework;
- acceptance first-pass rate;
- estimate vs fact;
- response time;
- invoice/payment disputes;
- material delivery reliability.

Twenty CRM is a UX/reference source only.

Never compute a public reputation score from insufficient/private evidence. Scorecards are project/organisation management evidence.

## Phase 8 — Commercial/document references

Use these only where a concrete requirement appears:

- **Documenso**: signing UX/provider patterns; current e-sign boundary stays.
- **Invoice Ninja**: invoice status, numbering and reconciliation patterns; no second accounting ledger.
- **Snipe-IT**: equipment/tool custody only if Renova enters asset management.
- **OpenProject**: project portfolio/dependency UX reference only.

## Cross-cutting tests

Every phase requires:

- project/team ACL negative tests;
- offline/retry/idempotency tests;
- object/evidence checksum validation;
- audit history;
- mobile viewport/E2E path;
- provider unavailable fallback;
- migration reconciliation;
- exact release evidence.

## Explicit prohibitions

Do not:

- replace Renova Project with OpenProject;
- create a second document archive;
- let CV/AI mark work accepted;
- let Timefold write schedule/budget without approval;
- let external signer/invoice service own Renova payment state;
- overwrite original evidence media;
- make annotations destructive.

## Suggested issue order

1. RENOVA-INT-00 Golden-path guard.
2. RENOVA-INT-01 Digital Site Diary.
3. RENOVA-INT-02 Punch/Hold Points.
4. RENOVA-INT-03 Skia evidence markup.
5. RENOVA-INT-04 tus resumable evidence.
6. RENOVA-INT-05 OpenCV before/after.
7. RENOVA-INT-06 C2PA + 360 timeline.
8. RENOVA-INT-07 PDF/drawing annotations.
9. RENOVA-INT-08 IFC contextual layer.
10. RENOVA-INT-09 Change Impact Engine.
11. RENOVA-INT-10 Contractor/Supplier scorecards.

**Implementation instruction:** strengthen the existing execution graph; do not import foreign authorities merely because an external project contains more features.

## Additional wave — secure file admission and privileged access

### ClamAV document/media admission — ADOPT/SIDECAR

Reference: https://github.com/Cisco-Talos/clamav

Renova already accepts project documents/evidence and has OCR. Add malware admission **before** OCR/document processing:

`upload -> temporary quarantine -> ClamAV -> checksum/type validation -> object storage admission -> OCR/preview/index`

A scanner outage is fail-closed for untrusted external uploads in production. Existing trusted/generated internal artefacts may use a separately documented path.

Never send quarantined files into OCR, PDF preview or downstream AI/indexing.

### Passkeys / step-up authentication — ADOPT

Server reference: https://github.com/duo-labs/py_webauthn

Add passkeys to high-risk roles and actions:

- contractor/customer account security;
- project admin;
- acceptance/rejection;
- payment/invoice approval;
- team-access changes;
- export/signature operations.

Passkeys are attached to the current Renova identity. They do not create another account system.

For irreversible/high-value actions, support recent-auth/step-up checks rather than assuming a long-lived mobile session is sufficient.

### Sentry React Native mobile observability — ADOPT

Reference: https://github.com/getsentry/sentry-react-native

Backend already has Sentry/OpenTelemetry dependencies. Extend release-aware crash/performance telemetry to the Expo/React Native client.

Correlate:

- mobile release/build;
- route;
- API correlation ID;
- offline queue state class;
- failed domain action class.

Do not capture project photos, document contents, payment data or chat message text by default.

### Additional acceptance

- malicious upload cannot reach OCR/document indexing;
- passkey recovery and lost-device flow are tested;
- mobile crash events resolve to exact app/backend release;
- telemetry redaction rules are covered by tests/review.

**Sequencing:** ClamAV can precede Site Diary expansion; passkeys should follow stable identity/session flows; mobile Sentry can be introduced independently but must use privacy-safe defaults.

## Additional wave — RFI, submittals, material traceability and warranty

This wave closes four execution gaps that appear after Site Diary / Punch / Documents become reliable: unanswered technical questions, material approvals, interoperability with BIM issue workflows, and post-handover defect obligations.

### RFI Authority — ADOPT

Create a native Request for Information lifecycle:

`draft -> issued -> assigned -> response due -> answered -> accepted/clarified -> superseded/closed`

Fields:

- project/work package/room;
- drawing/spec/document references;
- question;
- requesting party;
- responsible responder;
- due date;
- response;
- attachments/evidence;
- schedule/cost impact flag;
- related change request;
- revision history.

An RFI answer may trigger a Change Impact evaluation, but it does not itself modify scope/budget/schedule until the existing approval command is executed.

### Submittal / Material Approval Authority — ADOPT

Lifecycle:

`proposed material/product/sample -> technical docs -> contractor submission -> designer/customer review -> approved / approved with notes / revise / rejected -> procurement/use`

Track:

- specification requirement;
- manufacturer/model/SKU;
- finish/colour;
- sample/batch;
- certificates/docs;
- approval status/version;
- reviewer;
- substitution reason;
- linked purchase/work package.

A purchase/use of a controlled material can require an approved submittal version.

### Material Lot / Batch Traceability — ADOPT

For materials where batch/lot matters, connect:

`approved material -> purchase/delivery -> lot/batch -> storage/location -> installed work/room -> evidence/acceptance`

Use QR/barcode identifiers where useful, but Renova's internal lot/install record remains authority.

This enables questions such as "which rooms used the recalled/defective batch?" without introducing a warehouse ERP.

### BCF issue interchange — ADAPT

Use the open BIM Collaboration Format as an interchange boundary once IFC/BIM workflows are active.

Map:

`Renova Punch/RFI -> BCF issue snapshot -> external BIM tool -> returned comment/status -> reviewed Renova update`

BCF import/export must preserve:

- Renova issue ID/version;
- model/element references;
- viewpoint/snapshot;
- comments;
- external system ID;
- import/export timestamp.

External BIM tools never directly close a Renova acceptance/punch item.

### Speckle collaboration bridge — DEFER/CONDITIONAL SIDECAR

Reference: https://github.com/specklesystems/speckle-server

Consider Speckle only after the IFC contextual layer and BCF contracts are stable, for projects that actually need multi-discipline model/version exchange.

Boundary:

`external model/change stream -> adapter/read projection -> Renova element/work linkage`

Do not migrate project scope, payment, acceptance or evidence authorities into Speckle.

### Warranty / Defects Liability Period — ADOPT

After handover, create:

`accepted work -> warranty term -> reported defect -> triage -> contractor obligation -> repair -> reinspection -> closed/waived`

Track:

- warranty start/end;
- covered work/material;
- responsible contractor/supplier;
- defect report/evidence;
- SLA/due date;
- repair evidence;
- cost responsibility;
- accepted closure.

Warranty issues must be distinguishable from pre-handover punch items but link back to the same work/evidence history.

### Additional acceptance

- RFI responses are versioned and cannot silently alter approved scope;
- controlled material cannot be marked approved without reviewer/version;
- installed lot/batch can be traced back to approval and delivery evidence;
- BCF/Speckle round-trip cannot bypass Renova permissions/status rules;
- warranty responsibility and closure evidence are auditable.

**Sequencing:** Site Diary/Punch/Documents -> RFI/Submittal -> lot traceability -> BCF/Speckle if BIM demand exists -> warranty lifecycle as handover matures.

## Additional wave — open BIM requirements validation and structured handover

This wave activates the BIM layer only after ordinary PDF/document, RFI, Submittal and Punch workflows are already useful.

### IfcOpenShell model-processing worker — ADOPT/CONDITIONAL SIDECAR

Reference: https://github.com/IfcOpenShell/IfcOpenShell

Use a bounded worker to parse admitted IFC model versions and generate Renova read projections such as:

- IFC project/storey/space hierarchy;
- element GUID/type;
- selected approved properties;
- system/classification references;
- quantities where reliably present;
- element-to-room/work-package candidate links;
- model version/fingerprint.

Flow:

admitted IFC file -> checksum/version -> IfcOpenShell parse -> validated projection -> reviewer/linking -> Renova work/package context

The IFC file/model is design context. It must not become the source of payment, acceptance, project status or contractor obligation.

### buildingSMART IDS requirement validation — ADOPT/ADAPT

Specification/reference: https://github.com/buildingSMART/IDS

Use Information Delivery Specification-style requirements for machine-checkable project/model constraints.

Examples:

- required property present for a class of elements;
- classification/value requirements;
- space/system metadata;
- asset handover information required before completion.

Store in Renova:

- requirement-set ID/version;
- project/scope;
- source IDS artifact/checksum;
- validation run;
- model version;
- pass/fail/not-applicable;
- failing element references;
- reviewer/waiver.

A validation failure can create an RFI/Punch/Submittal task through explicit commands, but cannot automatically reject a payment milestone without the existing authority workflow.

### BIM Revision Delta — ADOPT

For consecutive admitted IFC versions, generate a reviewable delta:

- added/removed element GUIDs;
- changed selected properties;
- moved/changed space association where detectable;
- changed quantities;
- invalidated Renova links.

Every delta references both model checksums and parser version.

Use it to highlight potential scope impact; do not automatically classify every model delta as contractual change.

### COBie-style Handover Projection — ADAPT

Where the customer/project requires structured asset handover, generate a bounded handover export from accepted Renova + IFC data.

Possible fields:

- space;
- asset/component;
- type/model;
- serial/batch where available;
- supplier;
- install/acceptance date;
- warranty;
- approved document references.

The handover file is a derivative export. Warranty/acceptance/document authorities stay in Renova.

### Additional acceptance

- every IFC projection traces to source checksum + parser version;
- IDS validation is reproducible against a declared model and requirement set;
- model revision delta never silently changes linked work/acceptance state;
- generated handover data resolves to accepted Renova source records;
- an IFC/IDS processing failure cannot block non-BIM project workflows unless the project explicitly requires the gate.

**Sequencing:** Documents/RFI/Submittal -> IFC admission -> IfcOpenShell projection -> IDS validation -> revision delta -> structured handover.

**Dependency note:** IfcOpenShell currently uses LGPL licensing; confirm the exact integration/deployment mode and current license before packaging/distribution.

## Additional integration wave — schema-driven inspection and handover forms

This wave standardises repetitive inspection/acceptance workflows without hard-coding a new screen for every project checklist.

### JSON Forms renderer — ADOPT/ADAPT

Reference:

https://github.com/eclipsesource/jsonforms

Use JSON Schema + UI Schema as the rendering layer for versioned Renova inspection forms.

Candidate form types:

- room pre-inspection;
- work completion checklist;
- hold-point inspection;
- material incoming inspection;
- sample/submittal review;
- commissioning/handover checklist;
- warranty inspection;
- site-day structured checklist.

The form renderer is UI infrastructure only. Submitted answers become Renova-native inspection records/evidence.

### Form Template Authority — ADOPT

Create native entities:

- form_template;
- form_template_version;
- project/work-type applicability;
- schema;
- UI schema;
- required evidence rules;
- required role/reviewer;
- status/effective dates.

Never edit an already-used template version in place.

### Inspection Submission — ADOPT

Submission stores:

- project/work/room;
- template/version;
- respondent;
- answers;
- evidence attachments;
- started/submitted timestamps;
- review status;
- reviewer;
- failed requirement references.

A failed answer may explicitly create:

- Punch item;
- RFI;
- Submittal rework;
- Hold Point;
- Warranty defect.

The form itself does not directly mutate these workflows without a domain command.

### Conditional Evidence Rules — ADOPT

Examples:

- if answer = defect -> photo required;
- if material batch differs -> batch/lot evidence required;
- if inspection fails -> reason + assignee required;
- if approved with deviation -> authorised note required.

Rules are versioned with the template.

### PDF / Handover Output — ADOPT

Generate a human-readable immutable derivative from an accepted inspection submission for handover/export.

The PDF contains:

- template/version;
- project/work identifiers;
- answers;
- referenced evidence IDs;
- signatures/approvals where applicable;
- generated_at/checksum.

The PDF is derived evidence, not editable authority.

### Additional acceptance

- renderer cannot bypass role/project ACL;
- completed submission always points to exact immutable template version;
- schema validation runs server-side before acceptance;
- generated Punch/RFI/etc. are idempotently linked to the originating inspection;
- historical inspections remain readable after template evolution;
- form failure does not overwrite acceptance/payment state.

**Sequencing:** Punch/Hold/RFI/Submittal authorities first -> template/version model -> JSON Forms UI -> conditional evidence -> generated workflow links -> handover derivatives.

**Dependency note:** JSON Forms is currently MIT-licensed upstream and should remain replaceable presentation infrastructure.

## Additional wave — reality capture and 3D progress twin

This wave creates a premium remote-site/reality layer that can materially differentiate Renova from ordinary renovation/project-management products.

### Reality Capture Admission — ADOPT

Accept controlled capture sets:

- project;
- room/zone;
- capture session;
- source images/video/depth/point cloud;
- device;
- capture time;
- coordinate/reference method;
- checksums;
- operator;
- privacy review.

Raw capture evidence remains immutable.

### Open3D Geometry Worker — ADOPT/CONDITIONAL SIDECAR

Reference: https://github.com/isl-org/Open3D

Use for bounded geometry processing:

- point-cloud cleanup/downsampling;
- registration/alignment;
- plane extraction;
- distance/deviation calculation;
- room/geometry comparison;
- source-to-reference transforms.

Outputs are derived evidence with processor/version/checksum lineage.

### Plan / IFC Deviation Map — ADOPT

Where a reliable reference exists:

reality capture -> registration -> approved IFC/geometry -> deviation field -> reviewed issue candidate

Potential findings:

- wall/plane offset;
- opening/location mismatch;
- floor/ceiling level discrepancy;
- installed-object position discrepancy.

A geometric difference is not automatically a construction defect or contractual nonconformance. Human review decides whether to create Punch/RFI/Change.

### 3D Progress Twin — ADOPT

Create a time-based room/site view:

capture T1 -> T2 -> T3

Support:

- remote walkthrough;
- date comparison;
- 3D-linked Punch/evidence;
- corresponding work package/material/inspection context;
- owner/customer remote review.

The twin is a read/projection layer over Renova authority.

### Photorealistic reconstruction — EXPERIMENT/DEFER

Research reference: https://github.com/nerfstudio-project/nerfstudio

Use only if a pilot proves that photorealistic reconstruction materially improves remote review beyond panoramas/point clouds.

Source captures and calibrated geometry remain the auditable evidence.

### Capture Quality Gate — ADOPT

Measured deviation requires:

- sufficient coverage;
- acceptable registration residual;
- reliable scale/reference;
- declared reference model/version;
- acceptable device/capture quality.

Otherwise the capture is visual-only.

### Additional acceptance

- every geometry result traces to immutable source captures;
- insufficient capture quality cannot yield authoritative measurements;
- reference IFC/plan version is explicit;
- deviation cannot auto-fail payment/acceptance;
- 3D layer remains usable/rebuildable independently of an advanced renderer;
- household/site imagery obeys project ACL/retention/privacy rules.

**Sequencing:** media/evidence authority -> capture admission -> geometry registration -> deviation review -> progress twin -> optional photorealistic renderer.

## Premium commercial wave — Home Digital Passport and preventive care

Renova already has a real warranty authority. This wave **builds on it** and extends value after project closeout instead of creating another warranty system.

### Home Digital Passport — ADOPT

Create a post-handover passport for the completed object/home:

- project/object;
- room/zone;
- accepted work packages;
- installed materials/products/assets;
- supplier/contractor;
- lot/batch where tracked;
- acceptance evidence;
- manuals/certificates;
- warranty links;
- maintenance/care guidance;
- approved drawings/IFC references;
- before/after/progress evidence.

Passport records are projections over accepted Renova source facts.

### Installed Asset / Material Register — ADOPT

Create an owner-facing view:

room -> installed item/material -> model/spec -> install/acceptance date -> documents -> warranty -> maintenance

Examples:

- sanitary equipment;
- appliances;
- lighting;
- flooring/finishes;
- windows/doors;
- HVAC/engineering equipment;
- bespoke furniture where relevant.

Do not turn this into generic warehouse inventory.

### QR / Physical Asset Link — ADOPT

Optional QR label can open the authorised asset/passport record:

- what is installed;
- manuals;
- service history;
- warranty;
- contractor/supplier;
- compatible replacement/maintenance information.

QR contains an opaque identifier, never private project details directly.

### Preventive Maintenance Plan — ADOPT

For maintainable assets/work:

- maintenance task type;
- interval/date;
- source: manufacturer / contractor / owner;
- responsible service party;
- required document/evidence;
- reminder;
- completion/service evidence.

This creates recurring post-project engagement.

### Service / Repair Continuation — ADOPT

After closeout:

maintenance due / warranty issue / owner repair request -> service case -> contractor/service provider -> evidence -> completion

Warranty authority remains the existing Renova warranty domain. Non-warranty maintenance is a separate service case linked to the same asset/work history.

### Property Transfer Export — ADOPT

If the owner sells/transfers the property, generate a controlled handover/export package containing only approved transferable records.

Private conversations, prices or personal data are excluded unless explicitly authorised.

### Additional acceptance

- passport facts resolve to accepted/source records;
- current warranty implementation is reused, not duplicated;
- QR cannot expose unauthorised project data;
- maintenance tasks identify source/rule;
- service case distinguishes warranty vs paid/non-warranty work;
- owner can retain a useful passport even if advanced BIM/3D services are unavailable.

**Sequencing:** acceptance/closeout + current Warranty + Documents -> installed asset/material register -> passport -> maintenance -> service continuation -> transfer export.

**Commercial framing:** Renova becomes not only "manage my renovation" but a long-lived digital operating record for the finished home, enabling recurring service revenue.

