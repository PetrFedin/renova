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

## Premium enterprise wave — automated quantity takeoff and verified progress measurement

This wave connects IFC, estimate, reality capture and acceptance into a premium measured-progress capability.

### Quantity Baseline Authority — ADOPT

Create a versioned baseline linked to:

- project/work package;
- estimate line;
- room/zone;
- IFC/model element or drawing reference;
- quantity type;
- unit;
- planned quantity;
- measurement method/source;
- revision;
- reviewer/status.

Examples: area, length, count, volume, installed-component count.

Scope/design changes create new baseline revisions through Change authority.

### IFC Quantity Takeoff — ADAPT

Reuse:

https://github.com/IfcOpenShell/IfcOpenShell

Extract candidate quantities from admitted IFC versions.

Store:

- model checksum/version;
- element set;
- extraction rule/version;
- candidate quantity;
- validation status.

Model-derived quantities require review before becoming commercial baseline.

### Reality-capture Progress Measurement — ADAPT

Reuse the Open3D / Reality Capture layer where quality and reference geometry are sufficient.

approved baseline -> capture -> registration -> measured candidate -> reviewer -> accepted progress observation

Low-quality capture falls back to manual evidence.

### Installed Progress Ledger — ADOPT

Record:

- observed/completed quantity;
- observation date;
- method;
- evidence;
- reviewer;
- accepted/rejected state;
- cumulative progress;
- previous observation link.

Geometry never auto-approves money.

### Estimate / Schedule / Acceptance Bridge — ADOPT

Show:

planned quantity -> installed/accepted quantity -> remaining -> schedule implication -> cost/payment context

Measured progress may support progress report, contractor review, acceptance preparation and change analysis.

### Quantity Variance / Scope Drift — ADOPT

Detect:

- model vs estimate quantity;
- approved baseline vs installed;
- design revision effect;
- unexplained over/under quantity.

Variance can create RFI/Change/Punch through explicit commands.

### Additional acceptance

- every quantity has unit/source/revision;
- IFC extraction is reproducible;
- reality measurement requires quality gate;
- automated quantity never approves invoice/payment;
- scope change creates new baseline;
- manual measurement remains supported.

**Sequencing:** Estimate + IFC + Change + Reality Capture -> quantity baseline -> IFC takeoff -> measured progress -> acceptance/payment support -> variance analysis.

**Commercial framing:** auditable measured digital progress control connecting quantity, geometry, evidence and cost.

## Moat wave — insurance restoration and claim-evidence workspace

This wave opens a new B2B/B2B2C market: property-loss restoration for owners, adjusters, insurers and restoration contractors.

### Loss Event Authority — ADOPT

Create:

- property/project;
- loss event;
- event type/cause as reported;
- occurrence/discovery time;
- affected rooms/assets;
- claimant/owner;
- insurer/claim reference;
- adjuster/provider;
- evidence state;
- status.

Renova records facts/evidence; it does not determine insurance coverage.

### Pre-loss Baseline — REUSE

Reuse Home Digital Passport, accepted work, installed assets, prior condition and documents as the best available pre-loss baseline.

This is a major moat: verified construction history can reduce ambiguity after a loss.

### Damage Capture — ADOPT

Capture:

- photos/video/3D;
- affected zone;
- observed damage;
- measurement/quantity;
- material/asset;
- moisture/technical reading where manually/instrumentally supplied;
- source/device;
- timestamp;
- reviewer.

Reality Capture/Open3D may generate candidate geometry/quantity differences only through existing quality gates.

### Restoration Scope — ADOPT

Build a versioned restoration scope:

- remove/demolish;
- dry/clean/repair;
- replace;
- inspect/test;
- quantity;
- unit;
- estimate line;
- dependency;
- responsible party;
- status.

Scope versions never overwrite the original loss record.

### Claim Evidence Pack — ADOPT

Generate a reproducible package:

- loss timeline;
- pre-loss passport references;
- damage evidence;
- quantity takeoff;
- restoration estimate;
- contractor quotations;
- approvals/changes;
- progress/acceptance;
- invoice/payment references;
- checksums.

### Adjuster / Insurer Review Workspace — ADOPT

Provide scoped external review:

- request more evidence;
- accept/question line;
- attach assessment;
- mark review state;
- ask for inspection.

Review does not directly alter Renova contractor scope/payment authority.

### Restoration Progress — REUSE

Reuse:

- Quantity Progress;
- Change;
- RFI/Punch;
- Evidence;
- Acceptance;
- Warranty.

No separate construction engine is created.

### Coverage / Settlement Boundary — REQUIRED

Renova must not infer:

- whether policy covers the event;
- legal liability;
- insurer payment obligation.

Those remain external insurer/legal decisions.

### Additional acceptance

- loss evidence is immutable/versioned;
- pre-loss and post-loss states are distinguishable;
- insurer/adjuster access is scoped;
- automated measurements never determine coverage;
- restoration scope changes are auditable;
- claim pack resolves to exact source evidence.

**Sequencing:** Home Passport + Evidence + Quantity/Estimate -> Loss Event -> Damage Capture -> Scope -> external review -> restoration execution -> claim closeout.

**Commercial framing:** opens insurer, loss-adjuster, restoration-company and property-management markets using Renova's existing evidence/digital-twin moat.

## Platform economics wave — verified contractor and service network

This wave turns Renova's execution evidence into a trusted supply-side network for renovation, maintenance, warranty and insurance-restoration work.

### Contractor / Service Provider Passport — ADOPT

Create a provider record containing verified facts where available:

- legal/business identity;
- service categories;
- geography;
- team/capacity;
- insurance/licence/certificate references where relevant;
- completed Renova projects;
- accepted work packages;
- defect/rework history;
- warranty/service performance;
- evidence completeness;
- availability/capacity status;
- status/reviewer.

Do not treat self-entered claims as verified facts.

### Verified Performance Projection — ADOPT

Derive explainable metrics from actual Renova records:

- on-time completion;
- acceptance-first-pass rate;
- rework frequency;
- evidence completeness;
- warranty issue rate;
- response time;
- quantity/scope accuracy where applicable.

Always expose denominator, period and project mix.

No opaque universal contractor score.

### Service Request Marketplace — ADOPT

Owner/project manager can create a structured request:

- scope;
- location;
- time window;
- required capability;
- budget/estimate context if shareable;
- required evidence/certification;
- project/passport links;
- privacy scope.

Qualified providers may receive/accept/decline according to policy.

### Quote / Proposal Comparison — ADOPT

Compare:

- price;
- scope;
- exclusions;
- lead time;
- capacity;
- evidence/certification;
- historical verified performance.

Selection remains a human/commercial decision.

### Maintenance / Warranty Network — ADOPT

Home Passport assets can route:

maintenance need -> eligible provider -> appointment/service -> evidence -> completion

Warranty cases continue using the existing warranty authority.

### Insurance-restoration Network — ADOPT

Loss/restoration scopes can be matched only to providers approved for the required work/evidence process.

This creates a second B2B distribution market.

### Provider Qualification Levels — ADOPT

Possible labels:

- identity verified;
- evidence-ready;
- category-qualified;
- insurer/partner-approved;
- Renova-history verified.

Every label maps to explicit requirements; no vague "trusted" badge.

### Marketplace Economics — CONDITIONAL

Potential revenue:

- provider subscription;
- lead/service fee;
- enterprise insurer/property-manager network fee;
- premium qualification;
- maintenance contract.

Payment/commission logic must remain separate from work acceptance truth.

### Additional acceptance

- provider claims distinguish self-declared vs verified;
- performance metrics derive from canonical project evidence;
- provider cannot see unrelated project/private data;
- quote comparison does not auto-select cheapest/highest-score provider;
- qualification labels are auditable;
- marketplace incentives cannot alter acceptance/quality evidence.

**Sequencing:** Home Passport + Warranty + Quantity/Acceptance + Insurance Restoration -> provider passports -> verified metrics -> service requests -> qualification/network economics.

**Commercial framing:** Renova becomes a verified contractor/service network whose moat is real execution history, not anonymous review stars.

## Defensibility wave — Verified Execution Record and contractor capability credentials

This wave converts Renova's evidence, quantity, inspection, acceptance and warranty history into a proprietary execution standard that can travel with the property and contractor network.

### Renova Verified Execution Record — ADOPT

For an accepted work package generate a versioned record containing:

- project/object;
- work package;
- scope/specification version;
- contractor/provider;
- planned and accepted quantity;
- material/batch references where tracked;
- inspection/hold-point results;
- evidence references;
- acceptance decision;
- defects/rework history;
- completed_at;
- warranty reference;
- record version/hash.

This is not a generic "quality certificate"; it proves exactly which Renova process/evidence was completed.

### Execution Evidence Levels — ADOPT

Define explicit levels based on available evidence, for example:

- E0: administrative record only;
- E1: photo/document evidence;
- E2: structured inspection + evidence;
- E3: quantity/geometry verified;
- E4: accepted + warranty/passport linkage.

Names/levels may change during product design, but requirements must be machine-testable and transparent.

No project is penalised for using a lower level if the work type does not require advanced geometry.

### Contractor Capability Credential — ADOPT

Issue scoped credentials only from verified history, e.g.:

- bathroom waterproofing execution evidenced;
- electrical installation evidence-ready;
- BIM/IFC evidence workflow capable;
- warranty-response history verified;
- insurance-restoration evidence capable.

Credential includes:

- contractor/provider;
- capability;
- qualifying work count/period;
- evidence requirements;
- standard version;
- issued_at/review date/status.

It does not claim general contractor superiority.

### Property / Asset Execution Passport — REUSE

Home Digital Passport can surface the verified execution records attached to installed work/assets.

A property transfer can therefore include an auditable execution history rather than only invoices/photos.

### Network Trust Dimensions — ADOPT

For contractor/service discovery show explainable facts:

- identity verification;
- category credentials;
- accepted work count;
- first-pass acceptance;
- rework/warranty response;
- evidence completeness;
- last verified activity.

No opaque star ranking.

### External Verification — CONDITIONAL

Insurer/property manager/owner may verify a record or credential by ID without receiving unrelated project data.

### Additional acceptance

- execution record binds to immutable accepted source versions;
- evidence level requirements are explicit/versioned;
- contractor credential scope is narrow and evidence-backed;
- revoked/expired credential preserves historical qualification evidence;
- public verification reveals minimum necessary fields;
- work acceptance remains the existing project authority.

**Sequencing:** inspections + quantity + acceptance + warranty -> execution standard -> signed/versioned records -> contractor credentials -> passport/network verification.

**Moat:** every completed project compounds a verified execution history that improves contractor selection, insurance/restoration workflows and property trust.



## Institutional adoption wave — Property Trust Infrastructure

This wave turns Renova's Verified Execution Record, Home Passport and contractor credentials into infrastructure that insurers, property managers, developers, lenders and service networks can actually adopt.

### Renova Execution Evidence Specification — ADOPT

Publish a bounded, versioned interoperability specification for:

- work-package identity;
- scope/specification version;
- quantity/geometry evidence;
- inspection/hold-point result;
- material/batch reference;
- acceptance/rework history;
- warranty linkage;
- execution-record hash/status.

The open specification enables interoperability; Renova's hosted verification registry, longitudinal contractor history, analytics and network workflows remain value-added services.

### Reference Project / Synthetic Property Passport — ADOPT

Provide a synthetic reference implementation demonstrating:

`scope -> contractor -> evidence -> inspection -> quantity -> acceptance -> warranty -> property passport -> verification`

No real owner/property data may be included.

### Institutional Verifier Roles — ADOPT

Support scoped institutional consumers:

- insurer / loss adjuster;
- property manager;
- developer;
- technical customer;
- lender / due-diligence reviewer;
- warranty operator.

Each role receives only the minimum evidence projection required for its use case.

### Approved Service Network — ADOPT

Create explicit qualification paths for:

- contractors;
- inspectors;
- survey/measurement partners;
- restoration providers;
- warranty/service providers;
- implementation/integration partners.

Every qualification is scoped, versioned and evidence-backed.

### Institutional Publishing — CONDITIONAL

Approved external organisations may submit:

- inspection results;
- warranty/service events;
- restoration events;
- material certificates/references;
- property-management maintenance records.

External publishing never bypasses Renova admission, source classification or project authority.

### Insurance / Property-management Enterprise Bundle — ADOPT

Potential packages:

- Verified Execution Records;
- Property Passport;
- Contractor Qualification;
- Warranty & Maintenance Network;
- Insurance Restoration Evidence;
- Enterprise Verification API.

### Portfolio-level Trust Graph — ADOPT

For authorised enterprise customers, connect:

`property -> work package -> provider -> evidence -> acceptance -> warranty/service -> incident/restoration -> outcome`

Do not expose one customer's private property or commercial data to another.

### Legitimate Switching Cost — ADOPT

Accumulated value should come from:

- accepted execution history;
- geometry/quantity evidence;
- inspection lineage;
- warranty/service history;
- contractor capability history;
- property passport continuity;
- institutional integrations.

Export must remain possible; lock-in should come from useful history and network participation, not hostage data.

### Additional acceptance

- institutional users cannot alter original acceptance truth;
- external facts retain issuer/source identity;
- credential wording never implies government or insurer endorsement unless formally granted;
- property transfer can preserve public/authorised execution history without leaking prior-owner private data;
- open specification and hosted network authority remain clearly separated.

**Sequencing:** Verified Execution Record -> reference specification -> synthetic passport -> institutional verifier API -> approved service network -> insurer/property-manager pilots -> enterprise bundle.

**Moat:** Renova becomes the shared evidence rail connecting property work, contractor capability, warranty and institutional risk workflows.

## Research wave — grounded Project Intelligence and Digital Coworkers

**Status:** RESEARCH / PLANNED. This section records current competitive and technical findings; it is not evidence that AI search or agentic actions are already live.

Current 2026 market direction is moving from document-centric project management toward project intelligence grounded in connected project data:

- OpenSpace is exposing verified progress/reality data to AI agents and using visual progress for forecasting;
- Buildots combines measured progress, delay forecasting and a natural-language project assistant;
- Procore is introducing construction-specific Digital Coworkers and organisation-specific Skills;
- Autodesk is moving Autodesk Assistant toward AI-native, connected AEC project intelligence.

Research references:

- https://www.openspace.ai/resources/webinars/waypoint-2026-whats-new-in-openspace-track/
- https://www.openspace.ai/news/openspace-unveils-next-gen-visual-intelligence-at-waypoint-2026/
- https://buildots.com/blog/meet-dot-buildots-ai-assistant/
- https://buildots.com/platform/
- https://www.procore.com/press/procore-introduces-digital-coworker-packages-expands-ai-agent-library-and-previews-skills-to-help-construction-teams-put-ai-to-work
- https://www.autodesk.com/blogs/construction/meet-autodesk-assistant-ai-native-intelligence-in-forma/

### Project Intelligence Index — ADOPT/CONDITIONAL

Create an ACL-aware retrieval projection over existing Renova authorities rather than a new document/data authority.

Candidate indexed sources:

- project profile and room/work-package facts;
- approved estimate/scope versions;
- drawings/specifications and OCR text;
- RFI/submittal/inspection records;
- site diary and work logs;
- evidence/photos/360 capture metadata;
- chat messages where the requesting actor is authorised;
- schedule/change records;
- payments/cost facts only for actors that already have access;
- accepted work, warranty and Verified Execution Records.

Every indexed unit must retain:

- project_id / source_type / source_id;
- source version or checksum;
- authoritative timestamp;
- ACL/security classification;
- source deletion/revocation state;
- extraction/parser version;
- embedding/model version where semantic indexing is enabled.

No AI index is an authority. A result must always resolve back to the canonical Renova source.

### Hybrid Deep Search — ADOPT

Preferred default:

`PostgreSQL full-text search + optional pgvector semantic ranking -> ACL filter -> source re-rank -> cited result`

Reference:

- https://github.com/pgvector/pgvector
- https://github.com/pgvector/pgvector-python

Reasoning:

- Renova already treats PostgreSQL as authoritative;
- pgvector can stay inside the existing database/security/backup boundary;
- hybrid lexical + semantic search is preferable to a separate vector database until scale proves otherwise;
- approximate indexes must be monitored against exact-search recall before they become default.

Result UX:

- direct answer where supported;
- exact source citations/anchors;
- source freshness/version;
- confidence/coverage signal;
- `Недостаточно данных` when evidence is insufficient;
- one-tap jump to drawing page, message, photo, room, RFI, inspection or acceptance record.

No answer may silently merge facts from projects/threads the current actor cannot read.

### Multimodal Search — ADAPT

Add controlled retrieval for:

- photo -> visually similar / same room / same work package evidence;
- drawing fragment -> linked issue/RFI/evidence;
- object/material photo -> candidate installed asset/material references;
- before/after -> linked capture timeline.

Image similarity is discovery only. It must not declare installation, defect closure, acceptance or payment readiness.

Visual-document retrieval may be evaluated through pgvector-compatible pipelines, but model/provider choice stays replaceable and versioned.

### Renova Digital Coworkers — ADOPT

Do not build a generic chatbot on every screen.

Create bounded role/task agents such as:

- Daily Log Copilot — drafts a site-day summary from real events/evidence;
- RFI Copilot — prepares an RFI draft with drawing/spec references;
- Submittal Review Copilot — compares submission against declared requirements;
- Progress Brief Copilot — explains planned vs verified progress and blockers;
- Change Impact Copilot — prepares affected scope/schedule/cost evidence;
- Evidence Completeness Copilot — identifies missing required proof before inspection;
- Handover Copilot — prepares closeout/warranty/passport checklist;
- Contract/Specification Finder — answers with exact source citations only.

Every coworker action follows:

`query/context -> cited reasoning -> proposed command -> user review -> existing Renova command/API -> transaction/outbox/audit`

The agent never writes directly to domain tables and never calls a payment/signature/external provider outside the existing service/provider boundaries.

### Organisation Skills / Playbooks — ADOPT

Allow an organisation to define versioned operating rules such as:

- inspection checklist policy;
- required evidence by work type;
- RFI response SLA;
- material approval policy;
- naming/classification conventions;
- closeout requirements;
- escalation thresholds.

A Skill contains:

- organisation;
- name/version;
- applicable project/work type;
- structured rules;
- source documents/checksums;
- effective dates;
- reviewer/approver;
- test corpus.

AI may apply a Skill during analysis, but a Skill cannot override Renova ACL, financial authority, acceptance authority or safety/security policy.

### AI Decision / Action Receipt — ADOPT

For every high-value AI-assisted result, record:

- model/provider/version;
- prompt/policy version;
- source IDs/versions used;
- tool/command proposals;
- actor who approved/rejected;
- final canonical command result;
- latency/cost class;
- redaction/privacy class.

This creates reproducibility and supports future institutional audit without storing unnecessary hidden model reasoning.

### Acceptance

- every factual AI answer can resolve to current authorised sources;
- deleted/revoked source facts disappear from future retrieval;
- cross-project and restricted-thread leakage tests are mandatory;
- AI can propose but not silently approve money, acceptance, permissions or signatures;
- model outage degrades to ordinary Renova search/workflows;
- AI provider/model can be replaced without changing domain authority;
- every organisation Skill is versioned/testable.

**Sequencing:** current search/ACL truth -> project intelligence index -> cited deep search -> bounded copilots -> organisation Skills -> optional agent ecosystem.

---

## Spatial operations wave — autolocation, live capture and on-device intelligence

**Status:** RESEARCH / PLANNED.

OpenSpace's 2026 direction highlights AI autolocation, live capture coverage, voice field notes and measurements from captured geometry. Renova already plans reality capture/point clouds, but the capture **operator experience** and spatial localisation layer are not yet explicit.

Research references:

- https://www.openspace.ai/news/openspace-unveils-next-gen-visual-intelligence-at-waypoint-2026/
- https://www.openspace.ai/blog/waypoint-2026-recap/
- https://developer.apple.com/augmented-reality/roomplan/
- https://github.com/google-ai-edge/mediapipe
- https://github.com/facebookresearch/sam2

### Spatial Autolocation — ADAPT/EXPERIMENT

Goal:

`capture frame/sequence -> candidate room/zone/plan position -> confidence -> user correction -> admitted spatial anchor`

Signals may include:

- capture-session trajectory;
- known room geometry;
- plan/IFC features;
- visual feature matching;
- device motion/depth;
- QR/reference markers where available.

No wireless beacon infrastructure should be required by default.

Low-confidence localisation must remain manually correctable and may be stored only as a candidate until confirmed.

### Live Capture Coverage — ADOPT

During a site walk show:

- already captured zones;
- uncovered rooms/areas;
- capture quality warnings;
- disconnected/low-quality sequence;
- scale/reference confidence where measurement is intended.

The goal is to prevent returning from site with unusable evidence.

Coverage UI is operational guidance; only admitted capture evidence becomes durable authority.

### Voice Site Walk — ADOPT

Allow the user to record a field voice note while walking.

Flow:

`voice -> timestamp/spatial anchor -> transcription -> candidate structured items -> user confirms -> RFI/Punch/Task/Diary entry`

Candidate extraction can include:

- issue description;
- room/zone;
- responsible trade;
- due date phrase;
- work package;
- material/product reference.

Transcription or extraction errors must remain visible/editable before a domain record is created.

### LiDAR Room Capture — CONDITIONAL

On supported Apple hardware evaluate RoomPlan for fast interior capture:

- walls/openings;
- dimensions;
- room geometry;
- recognised room objects;
- USD/USDZ derivative.

RoomPlan output is a candidate geometry/capture source, not the estimate or contractual geometry authority.

Cross-platform boundary:

- LiDAR-enhanced capture must be optional;
- Android/non-LiDAR devices continue to support ordinary photo/360/manual-reference workflows;
- premium measurement claims require the existing Capture Quality Gate regardless of device.

### On-device Vision Assist — EXPERIMENT/ADAPT

MediaPipe is a candidate for privacy-sensitive device-side assistance such as:

- capture quality/orientation guidance;
- object/person detection for framing;
- document/photo classification hints;
- face/privacy-redaction candidate detection.

Where heavier server-side visual segmentation is useful, evaluate SAM 2 for:

- user-prompted defect/object masks;
- consistent mask propagation through short videos;
- assisted markup generation.

AI masks are editable annotation candidates only. Original media remains immutable.

### Privacy-safe Share Derivatives — ADOPT

Before external share/export, optionally create reviewed redacted derivatives for:

- faces/people;
- personal documents;
- addresses/phone numbers where detectable;
- sensitive room areas selected by owner.

Never destructively blur the source evidence. Store derivative checksum + redaction policy/version.

### 3D Gaussian Splatting pilot — EXPERIMENT/DEFER

Add a modern alternative to the existing NeRF research path.

Reference:

- https://github.com/nerfstudio-project/gsplat

Use only where a pilot proves clear benefit over 360 + point cloud:

- remote visual walkthrough;
- photorealistic time comparison;
- executive/client presentation;
- difficult visual context that ordinary captures do not communicate.

Geometry/measurement authority remains calibrated point-cloud/plan/IFC evidence; splats are presentation/derived spatial media unless separately validated.

### Acceptance

- autolocation always exposes confidence and manual correction;
- capture coverage never invents evidence;
- voice transcription cannot directly mutate domain state;
- LiDAR/non-LiDAR projects remain interoperable;
- vision segmentation never auto-closes defects or acceptance;
- external-share redaction preserves immutable source media;
- spatial models retain source/checksum/processor lineage.

**Sequencing:** Reality Capture Admission -> live coverage -> confirmed spatial anchors -> voice walk -> optional RoomPlan/on-device vision -> optional 3DGS.

---

## Predictive execution wave — pace, delay and recovery intelligence

**Status:** RESEARCH / PLANNED.

Buildots and OpenSpace increasingly combine verified progress with pace/risk forecasting. Renova already plans Change Impact and measured progress, but should add a distinct forecasting layer whose outputs are measurable and backtestable.

Research references:

- https://buildots.com/platform/
- https://buildots.com/solutions/delay-risk-mitigation/
- https://www.openspace.ai/blog/forecasting-built-on-your-projects-reality/
- https://www.openspace.ai/resources/webinars/waypoint-2026-whats-new-in-openspace-track/

### Pace Observation — ADOPT

Derive from existing authoritative facts:

- planned quantity/time;
- accepted/measured installed quantity;
- observed interval;
- trade/work package/room;
- blocker/hold-point state;
- material readiness;
- RFI/submittal readiness.

Compute explicitly:

- actual pace;
- planned pace;
- required recovery pace;
- confidence/coverage;
- observation freshness.

No progress percentage is accepted merely because a user typed it.

### Short-horizon Delay Forecast — ADAPT

For sufficiently observed work packages estimate:

- likely completion range;
- schedule-risk level;
- affected successors/milestones;
- confidence;
- reasons/evidence;
- data freshness.

Forecast must distinguish:

- measured delay signal;
- missing-data uncertainty;
- explicit known blocker;
- simulation assumption.

### Constraint / Root-cause Graph — ADOPT

Connect delay candidates to known facts:

- predecessor incomplete;
- unresolved Punch/Hold Point;
- open RFI;
- unapproved Submittal;
- missing material;
- delivery late;
- crew/workforce availability from Site Diary where captured;
- rejected/rework acceptance;
- design/model revision;
- owner/customer decision pending.

Do not claim causal certainty where the data only proves correlation/sequence.

### Recovery Scenario Simulator — ADAPT

Build on the existing Change Impact / Timefold-inspired planning layer.

Examples:

- resequence independent work;
- add crew capacity;
- split work area;
- expedite a material;
- move inspection/approval;
- change a non-contractual working sequence.

Output:

`scenario -> assumptions -> predicted delta -> conflicts -> cost implications -> required approvals`

Simulation never writes the schedule, budget or contract by itself.

### Forecast Accuracy Ledger — ADOPT

For each forecast store:

- forecast timestamp;
- input snapshot/version;
- predicted range/risk;
- actual outcome;
- error;
- model/rule version.

This prevents "AI forecasting" from becoming unmeasured marketing.

### Verified Progress / Payment Support — ADAPT

Where contract terms allow, display:

`verified progress -> accepted quantity -> payment eligibility context`

Renova may prepare payment/claim evidence, but no visual/AI progress result directly creates or approves a payment.

### Acceptance

- every forecast resolves to a versioned input snapshot;
- missing data widens uncertainty instead of fabricating precision;
- forecast accuracy is measurable over time;
- scenario recommendations are explicit assumptions;
- no auto-rescheduling or auto-payment;
- cross-project learning uses anonymised/authorised aggregates only.

**Sequencing:** Installed Progress Ledger -> pace observations -> short-horizon forecast -> constraint graph -> scenario simulator -> portfolio benchmarking.

---

## Collaboration wave — live spatial workspace without a second authority

**Status:** RESEARCH / CONDITIONAL.

Renova intentionally rejected a full-app CRDT as excessive. Keep that decision. Use conflict-free collaboration only where simultaneous editing is genuinely valuable.

References:

- https://github.com/yjs/yjs
- https://github.com/ueberdosis/hocuspocus

### Selective CRDT surfaces — CONDITIONAL

Candidate collaborative surfaces:

- drawing/photo markup;
- BIM/3D viewpoints and annotations;
- temporary review notes;
- whiteboard/sketch;
- inspection drafting;
- RFI/submittal drafting before submission.

Do **not** place these authoritative states in CRDT:

- payments;
- acceptance decisions;
- contract approvals;
- ACL/team membership;
- canonical estimate;
- warranty closure.

### Live Presence — ADOPT/CONDITIONAL

For supported review sessions show:

- active participants;
- current room/drawing/viewpoint;
- cursors/selection;
- "following presenter" mode;
- comment/annotation focus.

Presence is ephemeral and privacy-scoped.

### Offline collaboration merge — CONDITIONAL

For annotation documents only:

`local CRDT updates -> reconnect -> conflict-free merge -> explicit submit/freeze -> immutable Renova evidence/version`

Once submitted as evidence/inspection/RFI attachment, the accepted snapshot receives a normal Renova version/checksum and future collaboration happens on a new draft revision.

### Acceptance

- CRDT never becomes business authority;
- project ACL checked on connect and persistence;
- submitted snapshots are immutable/versioned;
- offline merge cannot mutate accepted evidence;
- presence does not leak restricted participants/project activity.

---

## Experience wave — Calm Spatial UI 2.0 and high-performance visual control room

**Status:** PLANNED DESIGN SYSTEM EXTENSION.

The objective is not decorative complexity. Renova should make dense construction truth feel simpler than competitor enterprise software.

### Responsive workspace modes — ADOPT

Desktop / monitor:

`project navigation | primary spatial/work canvas | context/evidence/decision rail`

Tablet:

`canvas/list split | collapsible decision rail`

Phone:

`single task focus | bottom sheet details | one primary action`

The same domain state and routes remain canonical across all modes.

### Spatial Control Room — ADOPT

For projects with capture/plan/BIM data, provide one composable workspace with:

- room/floor navigation;
- 2D plan / 3D / 360 switch;
- timeline/date scrubber;
- planned-vs-actual overlay;
- issue/RFI/inspection pins;
- evidence completeness heatmap;
- selected object's work/material/cost/acceptance context;
- next-action panel.

Do not create separate disconnected dashboards for each visual technology.

### Role-adaptive information density — ADOPT

Customer:

- outcome, money, decisions, evidence.

Contractor/site lead:

- work readiness, blockers, materials, inspections, next actions.

Supervisor/inspector:

- quality, evidence, hold points, deviations.

Enterprise/manager:

- portfolio risk, pace, exception-based drilldown.

Same facts, different projection; no role-specific duplicate truth.

### Site Mode — ADOPT

Field-optimised UI:

- large touch targets;
- camera/voice/issue quick actions;
- offline state always visible;
- minimal navigation depth;
- current room/work package fixed in context;
- sunlight/high-contrast mode;
- one-handed capture flow;
- explicit queued-vs-server-confirmed states.

### Motion and transition system — ADOPT

Use motion to preserve spatial/context continuity:

- list -> detail shared context;
- plan/room selection -> detail rail;
- timeline changes -> crossfade/geometry transition;
- optimistic local state only where server semantics allow it.

Provide reduced-motion behavior and never use animation to hide pending/error state.

### Visual performance budgets — ADOPT

Measure rather than assume:

- route/render p50/p95;
- long-list frame drops;
- image/360 decode time;
- 3D first useful frame;
- memory pressure;
- thumbnail/cache hit ratio;
- JS thread stalls.

Techniques may include:

- FlashList where already planned;
- thumbnail pyramids/progressive media;
- prefetch adjacent room/date captures;
- bounded 3D LOD;
- worker/WASM processing off the UI thread;
- explicit cache versioning by source checksum.

### Current BIM viewer modernization note

Do not adopt deprecated `web-ifc-viewer`.

For future browser BIM UI evaluate the current That Open stack:

- https://github.com/ThatOpen/engine_web-ifc
- https://github.com/ThatOpen/engine_components

`@thatopen/components` currently provides modular Three.js-based BIM tools including model loading, classification, clipping, measurements and floorplan navigation. Licensing must be re-verified at implementation time for every selected package/dependency.

xeokit remains a useful performance/reference benchmark, but its licensing/commercial terms must be reviewed before proprietary integration:

- https://github.com/xeokit/xeokit-sdk

### Acceptance

- no new UI mode creates duplicate domain routes/authorities;
- monitor/tablet/phone each have explicit screenshot/E2E contracts;
- Site Mode remains usable offline;
- motion respects reduced-motion/accessibility;
- spatial/3D features degrade to ordinary list/detail workflows;
- performance targets are measured on representative low/mid/high devices;
- advanced graphics never delay critical acceptance/payment/error UI.

---

## Research priority after the current admission chain

Do not implement these waves before the current exact-head admission / Verified Execution Record requalification sequence is closed.

Recommended order after that gate:

1. **Project Intelligence Index + cited Deep Search** — highest UX leverage across the existing product.
2. **Spatial capture operator UX** — live coverage + confirmed autolocation + voice walk.
3. **Pace / Delay Forecast** — only after verified progress observations exist.
4. **Bounded Digital Coworkers** — once cited retrieval and command proposals are trustworthy.
5. **Calm Spatial UI 2.0** — parallel visual productisation over stable authorities.
6. **Selective live collaboration** — only on surfaces with proven simultaneous-editing demand.
7. **RoomPlan / SAM 2 / 3DGS pilots** — experiments, not core dependencies.

This order intentionally prioritises information retrieval, field capture quality and measurable decision support before visually impressive but less foundational spatial AI.

## Visual system wave — Calm Construction OS 2.0

**Status:** PLANNED DESIGN-SYSTEM EXTENSION.

Current Renova UI already has central colour/spacing/radius/typography tokens, shared buttons, shared list typography and explicit rules against local hex/card duplication. Preserve that discipline.

The next visual-quality jump should come from a richer system layer, not screen-by-screen decoration.

### Responsive layout tokens — ADOPT

Create explicit responsive layout primitives instead of ad-hoc width checks:

- phone narrow;
- phone wide;
- tablet portrait;
- tablet landscape;
- desktop;
- large monitor.

Tokens should define:

- max readable content width;
- navigation rail width;
- context/decision rail width;
- canvas minimum size;
- gutter;
- panel stacking rules;
- sheet vs side-panel behavior.

Monitor/tablet/phone screenshots must be part of visual QA for critical flows.

### Density modes — ADOPT

Support bounded density projections over the same components:

- `comfortable` — customer/default mobile;
- `compact` — contractor/site tables and desktop control views;
- `presentation` — investor/client review, larger type and fewer secondary controls.

Density changes geometry only. It cannot hide required state, authority, error or evidence information.

### Depth / surface hierarchy — ADOPT

Current theme effectively has one card shadow level. Introduce semantic depth tokens:

- base canvas;
- raised card;
- floating toolbar;
- modal/sheet;
- critical overlay.

Prefer border/surface contrast over heavy shadows. The product should remain calm, precise and architectural rather than glossy consumer-fintech.

### Motion tokens — ADOPT

Create shared duration/easing contracts:

- instant state feedback;
- standard navigation/sheet;
- spatial context transition;
- long-running progress feedback.

Requirements:

- reduced-motion mode;
- no indefinite decorative motion;
- pending/server reconciliation remains visually explicit;
- destructive/financial transitions never appear complete before authority confirms.

### State transition choreography — ADOPT

Use motion only to explain state change:

- draft -> submitted;
- issue -> fixed candidate -> confirmed;
- acceptance requested -> accepted/rework;
- queued offline -> syncing -> confirmed/conflict;
- room/plan selection -> context rail;
- capture timeline T1 -> T2.

Animations must not replace text/status labels.

### Semantic data-visualisation system — ADOPT

Create versioned chart tokens and primitives for:

- planned vs actual;
- cumulative progress;
- pace;
- budget burn;
- variance;
- risk;
- evidence completeness;
- quality/rework;
- timeline confidence.

Rules:

- colour never carries the only meaning;
- all charts expose exact values/table fallback;
- no decorative 3D charts;
- missing data and zero are visually distinct;
- forecast and actual always use different semantics;
- confidence/coverage is visible beside predictive outputs.

### Spatial canvas chrome — ADOPT

Unify plan / BIM / 360 / evidence-view UI around one lightweight chrome:

- context breadcrumb;
- layer switcher;
- timeline/date;
- selection inspector;
- filter;
- compare;
- evidence status;
- primary action.

Do not build a different toolbar/navigation model for every renderer.

### Evidence visual language — ADOPT

Every evidence object should visually expose its trust state without technical jargon:

- source/original;
- derived;
- admitted;
- reviewed;
- accepted;
- superseded/revoked where applicable.

The UI must never make a generated derivative look like original evidence.

### Premium image/media presentation — ADOPT

For before/after, 360 and evidence galleries:

- stable aspect-ratio placeholders;
- thumbnail pyramid / progressive decode;
- source-date and location/room context;
- fast compare gesture;
- explicit original vs annotated toggle;
- swipe between same-room timeline captures;
- offline cache status where relevant.

Avoid loading full-resolution originals into list views.

### Field capture interaction system — ADOPT

Camera/voice/site actions should share a single bottom capture dock:

- Photo;
- Video/360;
- Voice;
- Issue;
- Measurement/markup where supported.

The dock inherits current room/work context and visibly shows offline/queued state.

### Empty/loading/error visual contracts — ADOPT

Introduce shared:

- skeleton primitives for known layout;
- quiet progress state for background refresh;
- explicit blocking loader only for blocking operations;
- recovery card with retry for dependency failure;
- stale-data badge when cached data is intentionally retained.

A loading skeleton must never be used when the application does not know the shape/content authority yet.

### Accessibility visual contract — REQUIRED

Add design-token tests for:

- dynamic type / text scaling;
- minimum contrast;
- minimum 44-point touch targets;
- reduced motion;
- focus-visible keyboard/web navigation;
- screen-reader labels for spatial controls;
- colour-blind-safe chart semantics;
- high-contrast Site Mode.

### Visual regression qualification — ADOPT

For canonical customer/contractor/supervisor journeys maintain screenshot contracts at:

- phone;
- tablet;
- desktop/monitor.

Qualification should detect:

- overflow/clipping;
- lost primary CTA;
- hidden error/attention state;
- unexpected local colors/components;
- broken responsive stacking;
- unreadable spatial overlays.

Do not freeze pixels for dynamic data; mask/normalise volatile content and assert structural visual contracts.

### Performance budgets for visual polish — REQUIRED

Premium visuals are rejected if they break interaction budgets.

Measure at least:

- cold screen first useful content;
- route transition latency;
- list scroll frame health;
- image/thumbnail decode;
- 360 first frame;
- 3D/BIM first useful frame;
- memory after repeated room/capture navigation;
- JS/UI-thread stalls.

Define representative low/mid/high device classes before making performance claims.

### Design-system debt already visible in current source

Current source inspection shows:

- no formal responsive breakpoint token set;
- no formal density-mode tokens;
- no shared motion/easing token set;
- no explicit reduced-motion design contract;
- one canonical card shadow level plus several local elevation/shadow definitions;
- no shared skeleton system;
- chart/UI visualisation exists in places but without a product-wide semantic chart token contract.

Treat these as design-system work, not isolated screen bugs.

### Acceptance

- all new screens use the same Calm OS visual language;
- no local visual innovation bypasses shared tokens/components without a documented exception;
- responsive behavior is proven on monitor/tablet/phone;
- spatial modes remain understandable without 3D;
- critical business truth remains readable with animation disabled;
- visual upgrades do not degrade low/mid-tier device performance;
- accessibility qualification ships with the visual system, not afterward.

**Sequencing:** responsive tokens -> density/depth/motion -> shared states/charts -> spatial chrome -> field capture dock -> screenshot/performance qualification -> advanced renderer polish.

## Mobile assurance wave — app/device integrity and transaction binding

**Status:** RESEARCH / CONDITIONAL SECURITY HARDENING.

Renova already has strong server-side identity/session, passkey roadmap, replay/idempotency and release signing controls. This wave adds device/app-origin assurance for sensitive native actions; it does not replace server ACL, session validation or business authority.

Official platform references:

- Apple DeviceCheck / App Attest: https://developer.apple.com/documentation/devicecheck
- Google Play Integrity: https://developer.android.com/google/play/integrity

### iOS App Attest — ADAPT

For supported production iOS devices:

`app instance -> App Attest key -> Apple attestation -> server key record -> per-sensitive-request assertion`

Server stores only the minimum required attestation/key metadata.

Candidate protected actions:

- acceptance/rejection;
- payment confirmation/approval;
- signature initiation/confirmation;
- team/access changes;
- high-value export/share;
- account credential/session recovery.

App Attest is a risk/integrity signal. Apple explicitly notes that no single policy eliminates fraud and that App Attest does not definitively identify every compromised operating system.

### Android Play Integrity — ADAPT

For production Android distribution, evaluate standard Play Integrity requests around high-risk actions.

Validate server-side:

- request binding/hash/nonce;
- recognised app identity/signing;
- licensing/distribution signal where applicable;
- device integrity tier;
- optional risk signals only when justified.

Use tiered enforcement rather than requiring the strongest device verdict for all users.

### Transaction Binding — ADOPT

Bind integrity assertions to the exact sensitive operation:

- user/session;
- project/resource;
- action kind;
- request/idempotency identity;
- canonical payload hash;
- nonce/challenge;
- issued/expiry time.

An assertion for one acceptance/payment/action cannot be replayed for another.

### Step-up policy matrix — ADOPT

Example tiers:

- ordinary reads/search: no device attestation requirement;
- routine low-risk writes: current auth/session/idempotency;
- high-risk approvals/access/signatures: recent-auth/passkey + app/device integrity when supported;
- suspicious/tampered environment: deny or require an alternative verified path depending on action/risk.

Never silently tell the user an integrity failure means their phone is "hacked". Present a neutral security/retry/support path.

### Graceful compatibility — REQUIRED

- unsupported devices do not lose ordinary read access;
- accessibility/emulator/development workflows use explicit non-production policy;
- provider/platform outage cannot corrupt business state;
- attestation failure is not treated as proof of fraud;
- a manual/operator recovery route exists for legitimate users;
- platform-specific signals never become project/business truth.

### Assurance receipt — ADOPT

For high-risk accepted actions, retain a bounded security receipt:

- action/request ID;
- recent-auth/step-up class;
- attestation provider/type;
- verdict class;
- challenge/payload binding hash;
- server verification result;
- timestamp;
- policy version.

Do not retain raw platform responses longer than operational/security need.

### Anti-abuse integration — ADAPT

Combine integrity with existing server signals:

- session/device history;
- OTP/passkey events;
- IP/rate-limit;
- replay/idempotency;
- unusual action velocity;
- account recovery;
- payment/provider risk.

No opaque single device score should independently approve or reject a financial or acceptance decision.

### Acceptance

- assertion replay against another request fails;
- copied assertion from another account/project fails;
- unsupported device follows documented fallback;
- platform outage cannot create a false business success;
- app/device integrity cannot bypass ACL;
- privacy-safe logs never contain reusable attestation secrets;
- high-risk action audit resolves to the exact assurance policy/version.

**Sequencing:** stable native distribution + passkey/step-up -> app/device attestation pilot -> transaction binding -> high-risk enforcement -> measured fraud/false-positive review.

## Enterprise control-plane wave — identity, provisioning and policy

**Status:** CONDITIONAL / ENTERPRISE-PILOT DRIVEN.

Do not convert Renova into a generic enterprise multi-tenant suite before a real institutional customer requires it.

The purpose of this wave is narrower: remove predictable procurement blockers for developers, property managers, insurers and large service organisations while preserving current Renova user/project/team authorities.

Standards:

- OpenID Connect Core: https://openid.net/specs/openid-connect-core-1_0.html
- SAML 2.0: https://www.oasis-open.org/standard/saml/
- SCIM Core Schema: https://www.rfc-editor.org/rfc/rfc7643
- SCIM Protocol: https://www.rfc-editor.org/rfc/rfc7644

### Organisation Boundary — ADOPT WHEN PILOT REQUIRES

Create an explicit organisation/customer-management boundary for enterprise configuration, not a replacement for project ACL.

Potential organisation-owned configuration:

- verified domains;
- identity-provider connection;
- provisioning policy;
- default security/retention policy;
- organisation Skills/Playbooks;
- approved service/provider policies;
- enterprise API/service accounts;
- portfolio/report access;
- billing/contract metadata.

Projects continue to own their domain state and participant permissions.

### Enterprise SSO — CONDITIONAL

Preferred modern path:

`enterprise IdP -> OIDC authorization -> verified subject -> Renova identity/account link -> ordinary session/ACL`

SAML support may be added for customers whose identity infrastructure requires it.

Requirements:

- issuer/audience/signature validation;
- explicit organisation/connection binding;
- immutable external subject mapping;
- account-link conflict handling;
- just-in-time provisioning policy separate from SCIM;
- recent-auth/step-up still applies to sensitive Renova actions;
- IdP authentication never grants project access by itself.

### SCIM Provisioning — CONDITIONAL

Expose a bounded SCIM service for enterprise-managed identities/groups only after organisation identity exists.

Candidate supported operations:

- Users create/update/deactivate;
- Groups create/update/delete;
- membership changes;
- discovery endpoints required by interoperable clients.

SCIM provisioned identity state must map through explicit Renova organisation policy before any project/team capability appears.

Deprovisioning must invalidate sessions/access promptly and preserve required audit/history rather than deleting business evidence.

### Group-to-role policy — ADOPT

Map enterprise groups to **organisation-level** capabilities such as:

- portfolio viewer;
- auditor;
- property manager;
- verifier;
- organisation administrator.

Do not map an IdP group directly to customer/contractor acceptance/payment authority across arbitrary projects.

Project-specific access remains explicit and auditable.

### Enterprise Service Accounts — ADOPT

For approved machine integrations:

- organisation-scoped service account;
- explicit capability scopes;
- short-lived/token-rotation policy;
- IP/mTLS/DPoP-style constraints where justified;
- separate identity from human users;
- no interactive login/session semantics;
- per-request audit identity.

Service accounts cannot masquerade as a human approver.

### API Access Products — ADOPT

Expose stable enterprise read/verification/event APIs around bounded domains:

- project/status projection;
- Verified Execution Record verification;
- Property Passport projection;
- approved evidence metadata;
- warranty/service events;
- webhook/event subscriptions.

Use versioned schemas, idempotent webhooks and minimum-data scopes.

Do not expose internal database shape as the public contract.

### Enterprise Audit Export — ADOPT

Support an organisation-authorised export containing:

- actor/service identity;
- action;
- resource;
- timestamp;
- request/correlation identity;
- decision/result;
- security/step-up class where applicable.

Exports are projections over canonical audit/domain history, not a second audit ledger.

### Retention / Legal Hold Policy — ADOPT

Renova already has document legal-hold concepts. Enterprise policy should extend this into explicit classes:

- active project;
- closeout;
- warranty/service;
- financial/legal;
- temporary derived/AI index;
- audit/security telemetry.

Requirements:

- retention rules are versioned;
- legal hold overrides ordinary expiry;
- source deletion propagates to derived search/AI indexes where legally allowed;
- business-history requirements remain separate from convenience caches;
- policy changes are audited.

### Data Residency / Processing Region — CONDITIONAL

Offer only when infrastructure/deployment actually supports it.

Store per organisation/contract:

- declared primary data region;
- permitted processing regions/providers;
- backup/DR region policy;
- AI/provider data-processing boundary;
- exception/transfer policy.

UI/docs must never claim residency merely from a logical organisation flag.

### Enterprise Security Posture Workspace — ADOPT

Provide administrators with a bounded view of:

- SSO/provisioning health;
- active privileged users/service accounts;
- recent step-up/auth anomalies;
- API/webhook credentials;
- retention/legal-hold policy;
- external integrations;
- audit export status;
- current release/security assurance evidence.

Do not expose platform secrets or other tenants.

### Break-glass / recovery — REQUIRED

Enterprise identity outage must not permanently lock legitimate owners out.

Provide:

- explicitly pre-authorised emergency admins;
- strong step-up/recovery;
- time-bounded break-glass session;
- visible audit/notification;
- post-event review.

Break-glass cannot silently bypass project acceptance/payment business rules.

### Acceptance

- IdP login alone never grants project authority;
- SCIM deactivation revokes future access while preserving historical attribution;
- service account actions are distinguishable from humans;
- group mapping cannot create cross-project privilege escalation;
- retention/legal hold applies consistently to source and derivative data;
- residency claims are backed by actual deployment topology;
- enterprise auth outage has a tested break-glass path;
- SSO/SCIM can be disabled without invalidating existing project evidence/history.

**Sequencing:** first enterprise pilot -> organisation boundary -> OIDC SSO -> audit/service accounts -> SCIM if customer requires lifecycle provisioning -> retention/residency policy -> broader enterprise control plane.

## AI assurance wave — retrieval security, evaluations and cost governance

**Status:** REQUIRED BEFORE WRITE-CAPABLE DIGITAL COWORKERS.

References:

- OWASP LLM01:2025 Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP AI Agent Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- NIST AI RMF / Generative AI Profile: https://www.nist.gov/itl/ai-risk-management-framework

### Untrusted-content boundary — REQUIRED

Treat all retrieved/user/external content as **data**, never trusted policy:

- uploaded PDFs/documents;
- OCR text;
- chat messages;
- RFI/Submittal content;
- imported emails/files;
- image metadata;
- external institutional submissions;
- web/provider text where later enabled.

An instruction embedded in a document must not be promoted to system/developer/tool policy merely because the model can read it.

### Retrieval ACL before model context — REQUIRED

Apply project/thread/document ACL **before** retrieval results enter model context.

Do not retrieve a broad cross-project set and ask the model to "ignore what the user cannot see".

Required negative tests:

- sibling project;
- restricted money thread;
- guest vs contractor;
- removed participant;
- archived/revoked document;
- legal-hold vs deletion behavior;
- enterprise organisation boundary when implemented.

### Source classification — ADOPT

Each model-context chunk includes:

- source authority/type;
- source_id/version/checksum;
- ACL class;
- untrusted-content marker;
- original vs derived;
- admission/review status;
- freshness/revocation state.

Prompt/tool templates can distinguish user request, trusted system policy, canonical Renova data and untrusted retrieved text.

### Tool allowlist / least privilege — REQUIRED

Every coworker receives only the minimum tools for its declared role.

Examples:

- search copilot: read-only retrieval;
- RFI copilot: create **draft** proposal only;
- change copilot: simulation/read + draft command;
- handover copilot: read/checklist preparation.

Never expose generic database, shell, arbitrary HTTP or unrestricted provider tools to product agents.

### Human authorisation gates — REQUIRED

AI proposals affecting any of these require explicit human review through existing domain commands:

- acceptance/rejection;
- payment/refund;
- contract/signature;
- user/team/project ACL;
- warranty closure;
- schedule/scope baseline;
- external publication;
- destructive deletion/retention override.

The approval UI shows exactly what will change before execution.

### Prompt-injection resistance tests — REQUIRED

Maintain adversarial fixtures including:

- direct override prompts;
- malicious instructions inside PDF/OCR text;
- hidden/encoded instruction variants;
- image metadata/alt-text injections where multimodal processing exists;
- fake "system message" inside project content;
- tool-exfiltration requests;
- cross-project data requests;
- persistent-memory poisoning attempts;
- malicious organisation Skill source.

Test the full product pipeline, not just the model prompt.

### AI evaluation corpus — ADOPT

Create a versioned synthetic/private-safe corpus for:

- exact cited fact retrieval;
- no-answer behavior;
- source conflict;
- stale/superseded source handling;
- ACL denial;
- Russian construction terminology;
- numerical amount/date/quantity fidelity;
- RFI/Submittal extraction;
- schedule/change reasoning;
- prompt-injection resistance.

Evaluation results bind to:

- model/provider/version;
- retrieval/index version;
- prompt/policy version;
- tool schema version;
- test corpus version.

### Quality gates — ADOPT

Before a model/prompt/index change is promoted, measure at minimum:

- citation precision;
- factual support rate;
- no-answer correctness;
- ACL leak rate = 0 in test corpus;
- tool-policy violation rate = 0;
- numeric/date fidelity;
- latency p50/p95;
- cost per request class;
- regression vs current qualified version.

Do not promote solely on subjective "better answers".

### Model/provider gateway — ADOPT

Hide provider-specific APIs behind a bounded Renova AI port:

`AI capability -> policy -> provider/model -> structured response -> validator`

Gateway responsibilities:

- provider/model allowlist;
- timeout/retry policy;
- structured-output validation;
- token/context limits;
- redaction policy;
- cost metering;
- fallback/degradation;
- region/data-processing policy;
- model version evidence.

Provider outage must degrade to ordinary Renova search/workflows.

### Context minimisation — REQUIRED

Send the minimum required project data to external models.

Prefer:

- retrieved chunks over whole-project dumps;
- opaque IDs over unnecessary personal details;
- explicit redaction/classification;
- local/on-device processing for privacy-sensitive assist where practical.

Never include unrelated private messages, payment details or identity data "just in case".

### AI cost / latency budgets — ADOPT

Define request classes, for example:

- search answer;
- document comparison;
- multimodal evidence analysis;
- long project brief;
- agent proposal.

For each class set:

- max context/tokens;
- max model cost;
- latency SLO;
- fallback model/path;
- cache eligibility;
- cancellation semantics.

Cost saving must never silently switch to a model below the declared quality/security gate for a high-risk task.

### Semantic cache — CONDITIONAL

Cache only safe deterministic-ish read outputs where:

- actor/ACL scope is part of the cache key;
- source versions/checksums are part of the key;
- model/prompt/index version is part of the key;
- revocation/deletion invalidates entries;
- sensitive outputs are encrypted/short-lived as required.

Never cross-share cached answers between organisations/projects without explicit public-safe provenance.

### Memory policy — CONDITIONAL

Product-agent memory must be explicit and bounded.

Allowed candidates:

- user-selected preferences;
- organisation Skill selection;
- non-sensitive workflow defaults.

Do not let arbitrary model output or retrieved project text silently become persistent memory.

### Incident / kill switch — REQUIRED

Support per-capability disablement:

- cited search;
- multimodal processing;
- specific coworker/tool;
- provider/model;
- organisation.

Kill switch disables new AI execution without breaking canonical project reads/writes.

### AI assurance receipt — REUSE

Reuse the previously defined AI Decision/Action Receipt and add:

- injection/guardrail result class;
- retrieval source count;
- evaluator/policy version;
- tool calls attempted/approved/denied;
- cost/request class.

Do not persist hidden chain-of-thought.

### Acceptance

- indirect prompt injection cannot grant additional tools or data;
- ACL is enforced before model context construction;
- write-capable tool call always maps to an existing authorised Renova command;
- model/provider change has repeatable evaluation evidence;
- cost/latency regression is visible;
- source revocation invalidates relevant retrieval/cache;
- product remains usable when all AI capabilities are disabled.

**Sequencing:** cited read-only retrieval -> adversarial/eval corpus -> AI gateway -> read-only copilots -> draft-only tools -> human-approved actions -> continuous red-team/evaluation.

## Property operations wave — commissioning, sensors and preventive service

**Status:** CONDITIONAL / POST-HANDOVER.

Renova should not become a general-purpose smart-home controller.

Its differentiated role is to preserve the construction-to-operation digital thread:

`installed asset -> commissioning proof -> configuration/reference -> warranty -> maintenance -> service event -> incident -> replacement/history`

Relevant interoperability direction:

- Matter overview: https://developers.home.google.com/matter/overview
- Matter 1.6 announcement: https://csa-iot.org/newsroom/matter-1-6-enables-more-intuitive-setup-multi-ecosystem-experiences-and-context-driven-control/
- Home Assistant Matter integration: https://www.home-assistant.io/integrations/matter/

### Commissioning Record — ADOPT

Extend Installed Asset / Home Digital Passport with a commissioning record where relevant:

- asset/device identity;
- model/serial/batch;
- installed location;
- installer/provider;
- commissioning date;
- firmware/version at handover where available;
- tested capabilities;
- network/protocol class;
- configuration/reference file checksum where appropriate;
- commissioning evidence/photos/report;
- warranty start/end;
- owner acknowledgement.

Do not store reusable network secrets, pairing codes or private keys in ordinary project records.

### Smart-home interoperability reference — ADAPT

Where a commissioned device is Matter-capable, store bounded metadata such as:

- Matter support/certification claim from admitted product documentation;
- device/category identity;
- installed room/asset link;
- commissioning state;
- controller/ecosystem reference chosen by owner.

Renova should not automatically join the owner's Matter fabric or become the primary Matter controller.

### Sensor / telemetry admission — CONDITIONAL

For high-value property-care use cases, admit selected derived events from owner-authorised systems, for example:

- leak/water alarm;
- temperature/humidity anomaly;
- indoor air-quality threshold;
- HVAC fault/service indicator;
- energy/consumption anomaly;
- equipment offline/maintenance signal.

Telemetry integration is opt-in and source-labelled.

Raw high-frequency time series should remain in the specialist telemetry/home-automation system unless Renova has a clear maintenance/evidence reason to retain it.

### Maintenance Trigger Engine — ADOPT

Combine:

- installed asset maintenance interval;
- warranty terms;
- admitted telemetry event;
- service history;
- room/property context.

Generate:

`maintenance due / inspect / contact provider / warranty candidate / urgent safety action`

This creates useful post-handover retention without pretending Renova diagnoses equipment autonomously.

### Warranty correlation — ADOPT

When an incident affects a known Installed Asset:

`incident -> asset -> installation/commissioning evidence -> warranty -> provider -> prior service -> claim dossier`

Prepare a claim/service package containing the minimum relevant evidence.

Never infer warranty coverage solely from a sensor alert.

### Property Health Timeline — ADOPT

Create a homeowner/property-manager timeline over durable facts:

- handover;
- asset commissioning;
- maintenance;
- service;
- warranty;
- incident/restoration;
- replacement;
- verification/inspection.

This becomes a long-term property-history asset and strengthens the Property Passport moat.

### Local-first / privacy preference — ADOPT

Where integration architecture permits, prefer local/interoperable events over mandatory vendor cloud dependence.

Requirements:

- owner explicitly authorises each source/integration;
- no background discovery of private home devices without consent;
- controller credentials are stored in a proper encrypted integration vault if ever required;
- minimum event data enters Renova;
- disconnecting an integration does not erase prior admitted maintenance/warranty history;
- private occupancy/behaviour inference is out of scope.

### Safety boundary — REQUIRED

Renova may display urgent sensor-derived warnings, but it is not a certified fire/security/medical/life-safety control system.

Do not route life-safety control loops through ordinary Renova cloud workflows.

### Service Network loop — ADOPT

With user approval:

`maintenance/incident -> recommended qualified provider -> service request -> appointment/work order -> evidence -> payment -> asset history`

This connects the post-handover Property Passport to the Approved Service Network and creates recurring network value.

### Acceptance

- Renova can operate with zero smart-home integrations;
- smart-home controller credentials/pairing secrets are not stored in ordinary domain rows;
- source/event identity is explicit;
- sensor event never auto-approves a warranty claim/payment;
- user can disconnect integrations;
- retained property history distinguishes telemetry signal from inspected/verified fact;
- Home Digital Passport remains useful as a document/asset history even without live telemetry.

**Sequencing:** Installed Asset Register -> commissioning records -> maintenance schedule -> optional event admission -> warranty correlation -> service-network loop.

## Product intelligence wave — outcome analytics and safe experimentation

**Status:** PLANNED / REQUIRED FOR EVIDENCE-BASED PRODUCT DEVELOPMENT.

Renova already distinguishes operational telemetry from product truth. Keep that separation.

Product analytics answers:

- did a user complete the intended workflow;
- how long did it take;
- where did they fail/abandon;
- did evidence/quality improve;
- did the feature reduce coordination cost;
- did a premium capability create durable retention/value.

It must not become a shadow business ledger.

### Privacy-safe event contract — ADOPT

Every product event uses a versioned schema.

Minimum fields:

- event_name/version;
- occurred_at;
- actor role class;
- project lifecycle class;
- surface/route;
- correlation/session class where privacy policy permits;
- feature/version;
- success/failure/abandon outcome;
- duration bucket where useful.

Avoid:

- raw chat/document contents;
- phone/email;
- payment requisites;
- precise address;
- photo bytes;
- unrestricted free text.

Use canonical domain IDs only when needed for aggregate correctness and protect them according to existing ACL/privacy policy.

### Event source boundary — REQUIRED

Product analytics events are derived observations.

They do not determine:

- project state;
- payment state;
- acceptance;
- subscription entitlement;
- warranty;
- ACL;
- evidence validity.

Domain truth remains in canonical Renova tables/services.

### Core activation funnel — ADOPT

Measure role-specific activation.

Customer candidate:

`account -> project created -> scope/estimate exists -> contractor/team connected -> first work evidence -> first acceptance decision`

Contractor candidate:

`account -> profile ready -> project assigned -> first work started -> first evidence submitted -> first accepted work/payment path`

Do not combine customer and contractor funnels into a misleading average.

### Outcome metrics — ADOPT

#### Acceptance cycle time

`accepted_at - acceptance_requested_at`

Segment by:

- work type;
- evidence completeness;
- first-pass vs rework;
- project complexity band.

#### First-pass acceptance rate

`accepted_without_rework / all_decided_acceptances`

#### Rework closure time

`closed_at - rework_requested_at`

#### Evidence completeness rate

For a governed requirement set:

`satisfied_required_evidence_items / required_evidence_items`

Do not count optional media as required completeness.

#### RFI cycle time

`resolved_at - submitted_at`

#### Submittal cycle time

`final_decision_at - submitted_at`

#### Schedule decision latency

Time between a surfaced actionable blocker and the first authorised resolution/decision event.

#### Offline recovery rate

`queued_actions_server_confirmed / queued_actions_eligible_for_retry`

Track conflict/rejection separately from transport failure.

### Search / AI outcome metrics — ADOPT

For cited Project Intelligence:

- search success/self-resolution;
- citation open rate;
- no-answer rate;
- reformulation rate;
- time to source;
- unsupported-answer regression from evaluation corpus, not production guesswork.

For coworkers:

- draft accepted unchanged;
- draft edited then accepted;
- draft discarded;
- time saved proxy;
- denied/blocked tool proposals;
- human override.

Never optimise AI solely for "engagement" or longer conversations.

### Field-capture metrics — ADOPT

Measure:

- capture session completeness;
- uncovered-zone warning rate;
- repeat capture caused by quality failure;
- evidence admission success;
- voice note -> confirmed structured item conversion;
- average time from issue observation to recorded issue.

Where a metric cannot be reliably observed, label it as survey/manual evidence rather than fabricating telemetry.

### Property Passport / post-handover metrics — ADOPT

- passport activation after handover;
- installed assets with complete commissioning record;
- maintenance reminder completion;
- warranty/service dossier creation;
- recurring service engagement;
- property history continuity after project closeout.

### Commercial metrics — ADOPT

Contractor:

- Free -> Pro conversion;
- trial activation/completion;
- active paid contractor retention;
- active projects per paid contractor;
- premium capability adoption.

Site Intelligence:

- active project-month usage;
- capture/inspection adoption;
- compute/media cost per active project;
- renewal/continuation.

Enterprise:

- organisation activation;
- SSO/provisioning adoption where deployed;
- verification/API usage;
- portfolio projects connected;
- retained annual contract value.

No commercial metric may incentivise weakening quality gates or manufacturing extra defects/actions.

### North-star family — ADOPT

Do not force one universal vanity metric.

Use a small family:

1. **Trusted Project Completion**
   - projects reaching governed handover/closeout with required evidence.

2. **Verified Work Throughput**
   - accepted work packages with complete governed evidence per active project period.

3. **Decision Cycle Efficiency**
   - median/p75 time for governed approval/acceptance/RFI/submittal decisions.

4. **Post-handover Continuity**
   - completed projects with active Property Passport/service history after closeout.

The business may select one primary planning metric later, but component metrics remain visible to prevent gaming.

### Experiment framework — CONDITIONAL

Feature flags/experiments may test:

- layout/navigation;
- empty-state education;
- search presentation;
- capture guidance;
- non-critical reminder timing;
- premium packaging.

Do **not** randomise core safety/business truth such as:

- ACL;
- acceptance authority;
- payment verification;
- signature meaning;
- retention/legal hold;
- security step-up;
- evidence requirements unless the experiment itself is a formally governed policy trial.

### Experiment assignment — REQUIRED

Where experimentation is allowed:

- deterministic assignment;
- declared population;
- start/end;
- primary/guardrail metrics;
- sample/data-quality checks;
- exclusion criteria;
- feature/version recorded;
- rollback/kill switch.

Avoid per-request random UX changes.

### Guardrail metrics — REQUIRED

Every speed/conversion experiment checks at least:

- error rate;
- abandonment;
- support/retry;
- accessibility regression;
- offline failure;
- privacy/security incidents;
- acceptance/rework quality where relevant.

A faster flow that increases false acceptance/rework is not a win.

### Analytics data-quality contract — ADOPT

Track:

- event schema/version;
- event producer version;
- duplicate rate;
- missing required fields;
- late events;
- client/server clock skew;
- identity/session change;
- offline buffered events;
- release SHA/app version.

Revenue/financial truth comes from billing/payment authorities, not client analytics events.

### Investor / operator outcome dashboard — ADOPT

Create an internal evidence-backed view after enough real usage exists:

- activation funnel;
- cycle times;
- evidence completeness;
- first-pass acceptance;
- rework;
- active projects;
- retention;
- paid conversion;
- support/error guardrails;
- feature adoption;
- verified forecast accuracy where applicable.

Never seed/fabricate production KPIs for investor presentation. Demo/sample data must be visibly labelled.

### Acceptance

- every metric has an explicit numerator/denominator or duration definition;
- unknown/missing is distinct from zero;
- product analytics cannot mutate business state;
- sensitive content is excluded/minimised;
- experiments cannot weaken security/acceptance/payment semantics;
- offline/duplicate event handling is defined;
- dashboards show data freshness/coverage;
- investor/operator metrics are reproducible from retained analytics + canonical business facts.

**Sequencing:** event dictionary -> activation/outcome metrics -> field/search metrics -> commercial/post-handover metrics -> internal dashboard -> bounded experiments.

## Mobile local data plane wave — scalable offline read models without a second authority

**Status:** CONDITIONAL / PERFORMANCE-DRIVEN.

Current source truth:

- canonical offline write queue is one AsyncStorage-backed JSON array;
- offline project search cache stores stages/rooms in AsyncStorage;
- chat search index stores title/last-message text in AsyncStorage;
- mobile currently has no `expo-sqlite` dependency;
- authentication tokens already use the separate secure-token path and must not move into an ordinary local database.

References:

- AsyncStorage: https://react-native-async-storage.github.io/
- Expo SQLite: https://docs.expo.dev/versions/latest/sdk/sqlite/

Do not migrate working offline semantics merely because SQLite is more sophisticated. Use measured size/latency/reliability thresholds.

### Local authority boundary — REQUIRED

Server remains authoritative.

Local structured storage is only:

- offline read projection;
- local search index;
- durable mutation intent;
- media/cache metadata;
- sync cursor/state;
- draft data where explicitly supported.

A local row cannot make acceptance/payment/ACL/business state authoritative.

### Phase 1 — structured offline read models — ADOPT WHEN NEEDED

First candidates:

- rooms/stages/work packages;
- document/evidence metadata;
- issues/RFI/submittals;
- asset/property-passport summaries;
- selected schedule projections;
- search index;
- capture/media metadata;
- last-known server version/freshness.

Benefits:

- query only needed rows;
- indexed filtering/sorting;
- incremental updates;
- bounded memory;
- better large-project offline search.

### Local full-text search — ADAPT

Evaluate SQLite FTS for offline exact search over admitted local projections:

- entity titles;
- document metadata/extracted safe snippets;
- issue/RFI titles;
- asset names;
- chat only where explicit local retention policy permits it.

This complements server Project Intelligence; it is not an offline clone of the entire semantic AI index.

### Sync cursor / projection versioning — ADOPT

Per project/projection track:

- server revision/cursor;
- schema version;
- last successful sync;
- stale/fresh state;
- deleted/revoked tombstones;
- actor/account ownership.

A different logged-in user must never inherit another user's offline projection on a shared device.

### Incremental sync — ADOPT

Prefer:

`server delta/cursor -> validate -> local transaction -> publish freshness`

over repeatedly downloading/serialising an entire project snapshot as data volume grows.

Fallback full resync remains available.

### Offline write queue migration — CONDITIONAL

The existing queue has significant hard-won semantics:

- per-user ownership;
- idempotent offline identity;
- retry/backoff;
- blocked/conflict states;
- storage corruption fail-closed;
- queue mutation lock;
- replay merge/version protection.

Do not rewrite it first.

Migration to transactional local storage is justified only if measured evidence shows:

- queue size/serialization latency problem;
- reliability problem under concurrent large queues;
- need for efficient per-project/per-state queries;
- atomic relation with other local draft state.

If migrated, preserve the exact existing queue contract and tests before deleting the AsyncStorage implementation.

### Sensitive local data classification — REQUIRED

AsyncStorage is an unencrypted key-value store; therefore classify what is safe to retain offline.

Do not put into ordinary local search/read storage without explicit security design:

- access/refresh tokens;
- provider credentials;
- bank/payment requisites;
- signature secrets;
- unnecessary personal data;
- raw high-sensitivity document content.

Where a business requirement justifies encrypted structured local storage, evaluate SQLCipher/native protected key material. Encryption-at-rest does not replace account/session fencing or remote ACL.

### Media cache boundary — ADOPT

Do not store large photos/360/video blobs inside SQLite.

Use:

- filesystem cache;
- content/checksum identity;
- DB metadata/index only;
- explicit storage quota;
- LRU/expiry;
- source revocation invalidation.

Offline evidence capture awaiting upload remains separately governed and visible to the user.

### Search/index revocation — REQUIRED

When source data is:

- deleted;
- access-revoked;
- project removed from user;
- participant removed;
- document superseded/revoked;

local projection/search indexes must remove or tombstone it on next authoritative sync.

Logout/account switch retains no accessible previous-user project content.

### Schema migrations — ADOPT

Local DB schema uses explicit versioned migrations and recovery tests.

Required cases:

- upgrade from previous released app version;
- interrupted migration;
- corrupt local DB;
- user switch;
- project purge;
- app downgrade unsupported path;
- rebuild from server.

Local corruption should degrade to projection rebuild, not corrupt server data.

### Performance decision thresholds — MEASURE FIRST

Before migration, instrument:

- AsyncStorage queue read/write p50/p95 vs item count/bytes;
- search-cache size and search latency;
- JSON parse/serialize time;
- memory peak;
- app-start impact;
- project switch latency.

Adopt SQLite for a data class only when measured benefit exceeds migration/complexity cost.

### Acceptance

- server state remains authoritative;
- offline projection is account/project fenced;
- local schema can rebuild from server;
- no token/provider secret regresses from SecureStore to ordinary DB;
- revocation/deletion propagates;
- existing offline idempotency/conflict behavior is preserved;
- large-project local search/filtering meets declared performance target;
- web fallback remains supported even if native SQLite path differs.

**Sequencing:** instrument AsyncStorage -> local read/search projection pilot -> incremental sync -> media metadata -> only then evaluate write-queue migration.

## Decision & Coordination Ledger wave — meetings, commitments and durable decisions

**Status:** PLANNED / HIGH-VALUE COORDINATION LAYER.

Current competitive direction validates a structured meeting workflow, but Renova should avoid creating a second task system.

References:

- Procore Meetings + Tasks integration: https://support.procore.com/products/online/user-guide/project-level/meetings
- Procore task management inside Meetings: https://support.procore.com/products/online/user-guide/project-level/meetings/tutorials/create-and-manage-tasks-in-the-meetings-tool
- Autodesk Meetings overview: https://construction.autodesk.com/tools/construction-meeting-records/
- Autodesk meeting/minutes workflow: https://www.autodesk.com/learn/ondemand/course/construction-project-management/unit/1AvYkpc3Hj0xp6CZ10E6SL
- Autodesk meeting follow-up/series: https://help.autodesk.com/cloudhelp/ENG/Build-Meetings/files/work-meetings/Manage_Meetings.html

### Product principle — meeting is context, not authority

A meeting record captures:

- who met;
- when/where;
- agenda;
- discussion notes;
- decisions;
- linked canonical project facts;
- action commitments.

It must not create parallel canonical copies of:

- tasks/work orders;
- issues/punch items;
- RFI;
- Submittals;
- schedule items;
- change orders;
- payments;
- acceptance decisions.

Where a meeting creates follow-up work, the meeting item links to the existing canonical entity.

### Meeting Series — ADOPT

Support recurring coordination types such as:

- weekly project coordination;
- owner/customer review;
- contractor/subcontractor coordination;
- design coordination;
- quality/inspection review;
- procurement/material review;
- closeout/handover review;
- warranty/service review.

A series owns:

- title/type;
- recurrence/calendar context;
- participant defaults;
- default agenda sections;
- previous-open-item references;
- permissions.

Each occurrence remains a distinct immutable/versioned project record after publication.

### Agenda — ADOPT

Agenda items can be:

- ordinary discussion topic;
- linked Issue;
- linked RFI;
- linked Submittal;
- linked Stage/Work Package;
- linked Material/Asset;
- linked Change Order;
- linked Inspection/Hold Point;
- linked Document/Drawing;
- linked previous Decision;
- linked canonical task/work order.

The agenda never duplicates the linked entity's state.

### Decision Record — ADOPT

A real project decision should be a durable object, separate from free-form notes.

Minimum fields:

- project_id;
- decision_id;
- title/summary;
- decision text;
- decision type;
- decided_at;
- effective_at where relevant;
- decision maker(s);
- meeting/source context;
- linked evidence/document/source IDs;
- linked affected entities;
- rationale/assumptions where appropriate;
- status;
- supersedes / superseded_by;
- created_by;
- version;
- published/finalised timestamp.

Candidate decision types:

- design;
- scope;
- schedule;
- material;
- quality;
- commercial;
- access/site logistics;
- acceptance-path;
- warranty/service;
- governance.

A decision record does **not** itself mutate scope, money, schedule or acceptance. It records the approved decision context, while the actual business change still goes through the existing canonical command/domain transaction.

### Decision supersession — REQUIRED

Project decisions evolve.

Use explicit lineage:

`Decision A -> superseded by Decision B -> current effective decision`

Never edit historical final decisions in place to make the past look different.

Views must show:

- current effective decision;
- superseded history;
- source meeting/document;
- affected entities;
- implementation state.

### Commitment / Action Link — ADOPT

A meeting follow-up item may create or link exactly one canonical action entity where applicable.

Examples:

- "Исправить примыкание" -> Project Issue / Work Order;
- "Ответить по узлу" -> RFI;
- "Согласовать образец" -> Submittal/Material approval;
- "Предоставить расчёт" -> Task/Work Order;
- "Подготовить допработу" -> Change Order draft;
- "Проверить скрытые работы" -> Inspection/Hold Point.

Meeting surfaces show the canonical item's current status rather than maintaining a second status.

This follows the same anti-duplication lesson Procore applied when it made Tasks the single tracked source for actionable meeting items.

### Commitment contract — ADOPT

Every actionable commitment should have, where applicable:

- canonical entity reference;
- owner;
- due date;
- priority;
- origin meeting/decision;
- completion evidence;
- verified completion state from the linked domain.

If no canonical domain entity fits, use one bounded generic Project Task object rather than storing "open/closed" only inside meeting minutes.

### Follow-up meeting behavior — ADOPT

Next meeting may inherit by reference:

- still-open commitments;
- unresolved decisions/questions;
- unresolved linked RFI/Submittal/Issue;
- prior agenda item context.

Closed items are not duplicated.

The follow-up view shows historical origin:

`opened in Meeting #4 -> carried into #5/#6 -> resolved before #7`

without creating copies of the underlying action.

### Minutes draft -> publish -> immutable record — ADOPT

Lifecycle:

`agenda -> live/draft minutes -> review -> publish/finalise -> immutable published version`

After publication:

- corrections create a new revision/addendum;
- prior published version remains retained;
- current effective version is explicit;
- distributed/exported record resolves to the exact version/checksum.

Do not let later edits silently change a previously distributed meeting record.

### Attendance / acknowledgement — ADAPT

Record:

- invited;
- attended;
- absent;
- external guest where allowed.

Optional acknowledgement:

- received/read minutes;
- explicit disagreement/comment within a bounded review window.

Acknowledgement is not automatically legal acceptance unless a separate contract/process explicitly gives it that meaning.

### Meeting source links — ADOPT

Meeting items/decisions can link to:

- drawing page;
- document version;
- photo/360 evidence;
- room/location;
- RFI/Submittal;
- issue/inspection;
- schedule stage;
- change/order;
- payment context where authorised;
- external approved source.

A decision must retain the exact source version/checksum where a later source revision could change interpretation.

### Decision Impact View — ADOPT

For a selected decision, show:

- affected room/work packages;
- linked schedule items;
- linked materials/assets;
- linked Issue/RFI/Submittal;
- linked Change Order;
- implementation status;
- unresolved downstream consequences.

This view is explanatory only; actual impact calculations remain in Change Impact / schedule/cost authority.

### Decision obligations — ADOPT

Track whether a final decision has all required implementation follow-through.

Example:

`Decision: switch finish material`
-> new approved material reference;
-> affected scope lines;
-> schedule implication reviewed;
-> change/commercial approval if required;
-> installation evidence later linked.

A decision can therefore be:

- decided;
- implementation_pending;
- partially_implemented;
- implemented;
- superseded;
- cancelled.

"Implemented" must be derived from explicit linked domain completion, not a manual checkbox alone.

### Decision conflict detection — ADAPT

Warn when a new proposed/final decision appears to conflict with:

- current effective decision on the same subject/entity;
- approved material;
- locked scope/baseline;
- active hold point;
- current schedule baseline;
- contract requirement;
- later superseding decision.

A warning does not choose the winner automatically.

### Meeting Copilot — ADAPT

Only after AI Assurance is in place.

Inputs:

- live notes/voice transcript;
- agenda;
- authorised linked project context.

Outputs:

- draft minutes;
- candidate decisions;
- candidate commitments;
- candidate links to Issue/RFI/Submittal/Work/Material;
- unresolved question list.

Required rule:

`AI draft -> human review -> publish/create canonical action`

The model cannot silently create a final decision, acceptance, change order or payment.

### Voice / field meeting capture — ADAPT

On mobile/tablet:

- voice capture;
- timestamp markers;
- quick "decision", "action", "question" markers;
- room/work context;
- photos/evidence attached during meeting.

Transcription is an editable draft.

### Meeting Room / Presenter Mode — ADOPT

For monitor/tablet meetings:

- current agenda item;
- linked drawing/evidence;
- open prior commitments;
- decision draft;
- assignee/due-date panel;
- next item.

After meeting:

- publish minutes;
- send/share;
- unresolved actions automatically remain visible through their canonical entities.

### Calendar / notification integration — ADAPT

Support:

- calendar event/ICS;
- reminders;
- participant notifications;
- due-action reminders;
- follow-up meeting scheduling.

Do not create a separate schedule authority for project work.

### Search & Project Intelligence — ADOPT

Deep Search should answer questions such as:

- "Когда решили заменить плитку?";
- "Кто согласовал этот материал?";
- "Почему перенесли срок?";
- "Какие решения по ванной ещё не выполнены?";
- "Что изменилось после совещания 12 сентября?".

Answers must cite:

- exact Decision;
- exact Meeting revision;
- linked canonical project records.

### Decision / coordination metrics — ADOPT

Measure:

#### Decision latency

`decided_at - first_formal_question_or_blocker_at`

where the start event is observable.

#### Commitment overdue rate

`overdue_open_commitments / open_commitments_with_due_date`

#### Decision implementation latency

`implemented_at - decided_at`

#### Carry-forward rate

`open_commitments_carried_to_next_meeting / open_commitments_at_meeting_close`

High carry-forward may indicate coordination friction; it is not automatically bad without context.

#### Decision reversal/supersession rate

Track by category and project phase.

Do not interpret supersession as "bad quality" without context; design evolution may be legitimate.

### Export / institutional record — ADOPT

Export a meeting/decision package that includes:

- meeting identity/version/checksum;
- attendees;
- agenda/minutes;
- decisions;
- linked commitments and current canonical status;
- source references;
- publication/revision history.

PDF is a derivative convenience artifact. Canonical machine-readable meeting/decision history remains in Renova.

### ACL / privacy — REQUIRED

A meeting participant does not automatically gain access to every linked project entity.

When a linked object is restricted:

- hide/redact the restricted content;
- preserve safe relationship metadata only when policy permits;
- do not leak restricted entity title/existence through search or exports.

External guest links are explicit, bounded and revocable.

### Acceptance

- meeting action status is never maintained independently from its canonical action;
- published minutes are versioned/immutable;
- decisions support supersession lineage;
- no meeting record directly bypasses scope/schedule/money/acceptance authority;
- follow-up meetings carry references, not duplicate actionable records;
- source document/evidence version is retained;
- AI produces drafts only;
- search can reconstruct why/when/by whom a decision occurred;
- deleted/revoked participant access cannot leak linked restricted content.

**Sequencing:** Meeting Series + agenda -> published versioned minutes -> Decision Record + supersession -> canonical commitment links -> Decision Impact/obligation view -> Meeting Copilot -> analytics.

## Material provenance & sustainability passport wave — DPP/EPD-ready product history

**Status:** CONDITIONAL / INTERNATIONAL & ENTERPRISE VALUE.

This wave is not a generic ESG dashboard and is not required for ordinary Renova projects.

It extends the existing Material Lot/Batch Traceability + Installed Asset Register + Home Digital Passport so that selected products can retain trustworthy machine-readable provenance and environmental/compliance metadata where the jurisdiction/customer requires it.

Current regulatory/interoperability direction:

- EU Digital Product Passport: https://single-market-economy.ec.europa.eu/single-market/digital-product-passport_en
- EU CPR 2024 revision: https://single-market-economy.ec.europa.eu/sectors/construction/construction-products-regulation-cpr/cpr-2024-revision_en
- CPR CE / Declaration of Performance and Conformity: https://single-market-economy.ec.europa.eu/sectors/construction/construction-products-regulation-cpr/ce-marking-and-declaration-performance-and-conformity_en
- buildingSMART Product Domain: https://www.buildingsmart.org/standards/domains/product/

### Product identity / source admission — ADOPT

For selected installed materials/products, retain:

- manufacturer;
- product family/model;
- product identifier;
- batch/lot where relevant;
- supplier;
- admitted product documentation;
- declaration/certificate identifier;
- source URL/provider;
- source version/checksum;
- jurisdiction/standard scope;
- validity/effective period where applicable.

Renova must distinguish:

- manufacturer claim;
- third-party declaration/certification;
- imported supplier data;
- Renova-observed installation evidence.

Do not convert a manufacturer claim into a verified Renova fact merely because it exists in a PDF or DPP.

### DPP / DoPC reference — CONDITIONAL

Where a construction product exposes an official Digital Product Passport or Declaration of Performance and Conformity:

`external product identifier -> admitted DPP/DoPC metadata -> exact source/version -> Renova material/product -> delivery lot -> installed asset/room`

Store references and the minimum required admitted metadata.

Do not mirror an entire regulatory registry unless there is a clear offline/compliance reason.

### EPD / environmental declaration support — ADAPT

For products with an Environmental Product Declaration or equivalent source:

- declaration identifier;
- programme/operator;
- declared unit;
- valid-from / valid-until;
- product scope;
- source checksum/version;
- selected environmental indicators;
- standard/method reference.

Environmental numbers must always retain:

- unit;
- lifecycle module/scope;
- source declaration;
- declared/reference quantity;
- version.

Never sum incomparable EPD values with different declared units/scopes without explicit normalisation rules.

### Embodied-carbon project view — CONDITIONAL

Only when the input data is sufficiently complete and comparable:

`installed quantity x admitted environmental factor -> product/work/room/project contribution`

Required output:

- included products;
- excluded products;
- coverage percentage;
- method/version;
- assumptions;
- unit conversions;
- source declarations;
- uncertainty/missing data.

Do not display a single "project carbon" number if material coverage is insufficient.

### Material health / emissions metadata — ADAPT

Where trustworthy source data exists, retain bounded properties such as:

- VOC/emissions classification;
- restricted substance declaration;
- safety/use instructions;
- relevant indoor-environment certifications.

These are source-labelled compliance/selection facts, not Renova medical/safety guarantees.

### Circularity / end-of-life — ADOPT/CONDITIONAL

For suitable products/assets:

- disassembly/reuse guidance;
- recycled/recyclable content claims;
- spare part/service references;
- end-of-life/recycling instructions;
- material composition where legally/publishably available;
- take-back/provider programme.

Link these to Property Passport and future refurbishment/service events.

### Procurement comparison — ADAPT

During material selection, optionally compare admitted candidates across:

- price;
- lead time;
- technical requirement fit;
- approved status;
- durability/warranty;
- environmental declaration availability;
- embodied-impact metric where genuinely comparable;
- repairability/reuse/end-of-life metadata.

Environmental data is one decision dimension; it must not silently override budget, performance or customer preference.

### Product data dictionary mapping — ADAPT

Where structured product data is available, map external property definitions to a stable internal product-property vocabulary.

buildingSMART Product / bSDD-compatible semantics may be evaluated for:

- property names;
- units;
- classifications;
- IFC/product linkage.

Do not hard-code vendor-specific property names as the permanent Renova schema.

### Property Passport handover — ADOPT

At handover, selected installed products can expose:

- exact installed product identity;
- batch/lot;
- room/location;
- purchase/install evidence;
- DPP/DoPC/EPD links;
- warranty;
- maintenance;
- replacement/end-of-life guidance.

This makes the Home Digital Passport useful for later renovation, resale, property management and service.

### International jurisdiction policy — REQUIRED

Do not claim EU regulatory compliance merely because Renova stores a DPP/EPD link.

Per project/organisation declare:

- applicable jurisdiction;
- required product documentation;
- accepted declaration/certificate classes;
- who validates compliance;
- effective rules/version.

Russian/CIS projects can use the provenance/passport functionality without inheriting EU compliance labels.

### Source update / revocation — ADOPT

External declarations/passports can be:

- updated;
- expired;
- corrected;
- withdrawn.

Use the same source-admission/change-impact discipline:

`external change -> candidate source update -> review -> affected installed products/projects -> impact notice`

Historical installation record retains the source/version used at selection/install time.

### Supplier/manufacturer interoperability — CONDITIONAL

Future enterprise/OEM integrations may allow approved suppliers/manufacturers to publish:

- product master data;
- compliance docs;
- DPP/EPD references;
- replacement product mappings;
- maintenance instructions;
- recall/safety notices.

External publication enters an admission queue; it never directly overwrites installed-project truth.

### Commercial / network value

Potential enterprise value:

- developer/property-manager material registry;
- verified product documentation completeness;
- portfolio-level installed-product lookup;
- recall/update impact analysis;
- sustainable procurement reporting;
- manufacturer/service network integrations;
- property resale/refurbishment passport continuity.

Do not monetise by hiding required safety/compliance data behind a paywall for parties already entitled to it.

### Acceptance

- external product claim is distinguishable from Renova-observed installation;
- environmental values retain exact source/unit/scope/version;
- incomparable declarations are not silently aggregated;
- DPP/DoPC/EPD updates do not rewrite historical install evidence;
- jurisdiction/compliance claims are explicit and bounded;
- property passport remains useful without sustainability data;
- product source withdrawal can trigger impact review;
- no sustainability score is fabricated from missing coverage.

**Sequencing:** product identity/source admission -> DPP/DoPC/EPD references -> installed-product linkage -> Property Passport handover -> optional comparable impact view -> portfolio/enterprise reporting.

## Property Trust & Transfer Infrastructure wave — resale, finance, insurance, recall and verified building history

**Status:** PLANNED / LONG-LIVED PROPERTY TRUST LAYER.

This wave **extends** existing Renova capabilities:

- Home Digital Passport;
- Property Transfer Export;
- Installed Asset / Material Lot Traceability;
- insurance restoration / claim-evidence workspace;
- Verified Execution Record;
- Institutional Verifier;
- Material Provenance & Sustainability Passport.

It does **not** create another competing passport, cadastral registry, appraisal system, title registry or insurance decision engine.

The objective is:

`verified renovation history -> transferable property dossier -> role-specific evidence profile -> external verification -> continued property history after ownership/project changes`

### Regulatory / interoperability context

Relevant open/public standards and policy direction:

- EU Energy Performance of Buildings Directive (EU) 2024/1275, renovation passports and digital building logbook relationship:
  - https://eur-lex.europa.eu/eli/dir/2024/1275/oj/eng
  - https://energy.ec.europa.eu/document/download/0a4a6d59-58c0-4e80-a58a-a6ee944573ab_en
- EU Digital Product Passport / CPR-2024 construction-product direction:
  - https://single-market-economy.ec.europa.eu/single-market/digital-product-passport_en
  - https://single-market-economy.ec.europa.eu/sectors/construction/construction-products-regulation-cpr/cpr-2024-revision_en
- buildingSMART IFC / openBIM:
  - https://www.buildingsmart.org/standards/
  - https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/
- W3C Verifiable Credentials Data Model 2.0:
  - https://www.w3.org/TR/vc-data-model-2.0/
- ACORD Property & Casualty standards:
  - https://www.acord.org/standards-architecture/acord-data-standards/property-casualty-data-standards
- MISMO property/mortgage data standards:
  - https://www.mismo.org/standards-resources
  - https://www.mismo.org/standards-resources/mismo-product/property-and-valuation-services-implementation-guide
- EU Safety Gate:
  - https://ec.europa.eu/safety-gate/
- US CPSC recalls API:
  - https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information
- UK OPSS recalls/alerts:
  - https://www.gov.uk/guidance/product-recalls-and-alerts

These are interoperability/reference inputs. Renova must not claim jurisdictional compliance merely because it can map/export compatible data.

### Verified Building History — ADOPT

Create a durable, queryable timeline over **verified or source-labelled property facts**.

Candidate history events:

- project/renovation start and closeout;
- accepted scope baseline;
- material/product approval;
- major design/scope decision;
- approved change;
- installation / commissioning;
- inspection / hold-point result;
- acceptance/rework;
- significant defect/restoration;
- warranty/service;
- installed-asset replacement;
- major technical-system change;
- admitted product recall/safety action;
- energy/renovation passport reference where available;
- ownership-transfer dossier issuance;
- superseding/correcting record.

Each event retains:

- property/project identity;
- event type;
- effective time;
- source authority/type;
- source IDs/versions/checksums;
- affected rooms/assets/products;
- actor/issuer where relevant;
- verification/admission state;
- supersession/correction lineage;
- privacy/transferability class.

The timeline is a **property-history projection** over canonical Renova domains. It is not a new business ledger.

### History truth classes — REQUIRED

Every history fact must be labelled as one of:

- Renova observed/accepted;
- external authoritative/official source;
- owner-provided;
- contractor/provider declaration;
- manufacturer/supplier declaration;
- derived/calculated;
- unverified candidate.

A source-labelled owner/manufacturer claim cannot visually become a Renova-verified fact.

### Property Transfer Dossier — ADOPT

Upgrade the existing Property Transfer Export into a controlled dossier profile for sale, handover, inheritance/management transfer or new operator onboarding.

Candidate dossier sections:

1. Property/renovation identity summary.
2. Major completed works.
3. Current room/asset structure.
4. Installed assets/materials with product/lot identity where available.
5. Commissioning records.
6. Warranty/maintenance status.
7. Major accepted changes/decisions.
8. Quality/inspection summary.
9. Open known issues/warranty cases.
10. Major restoration/loss-event history where legally/contractually transferable.
11. Product recall/safety actions affecting installed assets.
12. DPP/DoPC/EPD/product-source references where applicable.
13. EPC / official renovation-passport references where available.
14. Selected drawings/as-built/BIM/IFC derivatives where authorised.
15. Verification manifest / checksums.

Default exclusion:

- private chats;
- unrelated personal data;
- contractor/customer private notes;
- bank/payment requisites;
- hidden commercial pricing;
- authentication/security data;
- non-transferable legal/insurance material.

Owner/export policy explicitly selects exceptional inclusions.

### Transfer Manifest — ADOPT

Every issued transfer dossier receives a manifest containing:

- dossier ID/version;
- property/project scope;
- generated_at;
- source cutoff timestamp;
- included source IDs/versions;
- excluded categories;
- file/object checksums;
- issuing actor/organisation;
- expiry/current-status semantics where relevant;
- verification URL/API reference;
- supersedes / superseded_by.

A later regenerated dossier does not overwrite the previous issued package.

### Human + machine-readable package — ADOPT

Provide:

- concise human-readable PDF/report;
- machine-readable JSON/JSON-LD profile;
- file/evidence manifest;
- optional IFC/openBIM references;
- optional signed portable verification artifact.

PDF is a derivative convenience format, not the sole authority.

### Portable property credentials — CONDITIONAL

Evaluate W3C Verifiable Credentials 2.0 only for bounded portable claims such as:

- verified execution checkpoint;
- qualified contractor/inspector attestation;
- commissioning completion;
- selected transferable property-history checkpoint;
- institutional verification result.

Boundary:

`issuer -> credential -> holder/owner -> verifier`

The credential references canonical evidence/version/status and is revocable/status-aware.

Do not encode the entire property database into one giant credential.

### EU Renovation Passport / Digital Building Logbook alignment — ADAPT

For EU projects, Renova may **reference/import/export compatible fields** around:

- current energy-performance information;
- completed major renovations;
- planned staged renovation steps;
- relevant materials/systems;
- maintenance/lifetime information;
- digital access references.

Directive (EU) 2024/1275 requires Member States to introduce renovation-passport schemes and provides that, where available, renovation passports are stored in or accessible via a digital building logbook.

Renova does **not** self-issue an official national renovation passport unless an authorised legal/technical framework explicitly permits that role.

The official/expert-issued passport remains a source; Renova links it to actual later execution history.

### Resale Due-Diligence Workspace — ADOPT

For an owner-authorised prospective buyer/advisor, create a time-bounded, least-privilege workspace.

Views:

- property-history summary;
- completed renovation scope;
- installed asset/material passport;
- open known defects/warranty;
- maintenance history;
- transfer-approved documents;
- before/after evidence;
- official certificate/passport references;
- verification status.

The prospective buyer does not receive ordinary project membership or private communications by default.

### Disclosure state — ADOPT

For each transferable fact/document:

- transferable by default;
- owner-review required;
- restricted;
- legally required where configured by jurisdiction/policy;
- expired/superseded;
- not available.

Renova does not decide what law requires disclosure without an explicit jurisdiction/policy source.

### Lender / Valuation Evidence Profile — CONDITIONAL

Create a **read-only evidence profile**, not an underwriting or valuation engine.

Potential lender/appraiser inputs:

- property identity/context supplied by owner/institution;
- major renovation chronology;
- completed/accepted work;
- room/area facts where authoritative;
- installed systems/assets;
- significant condition/restoration facts;
- selected drawings/floor plans/media;
- energy-performance / official renovation-passport references;
- verified execution checkpoints;
- source freshness/coverage.

Where a US/international partner requires mortgage-data interoperability, evaluate a mapping adapter to current MISMO Property & Valuation Services / Reference Model profiles.

MISMO is an exchange standard boundary; Renova's internal schema does not become MISMO-shaped.

Renova must not output:

- property market value as verified fact unless supplied by an authorised valuation source;
- lending eligibility;
- loan approval;
- automated appraisal opinion presented as licensed appraisal;
- hidden creditworthiness inference.

### Evidence coverage for lender/valuer — ADOPT

Every profile shows:

- covered facts;
- missing facts;
- source types;
- latest verification date;
- known stale/superseded elements;
- owner-provided vs Renova-verified distinction.

"Complete" cannot mean merely "all optional Renova fields are populated".

### Insurer / Adjuster Evidence Profile — ADOPT

Reuse the existing insurance restoration/claim-evidence workspace and Pre-loss Baseline.

Provide a bounded insurer/adjuster package containing, where owner-authorised:

- pre-loss property baseline;
- installed product/asset identity;
- accepted prior work;
- commissioning/maintenance history;
- loss-event evidence;
- affected rooms/assets;
- restoration estimate/work/acceptance;
- exact source/checksum manifest;
- recall/safety state relevant to affected products.

Where a partner requires insurance-industry interoperability, evaluate an ACORD P&C adapter.

Renova records/exchanges evidence. It does not determine:

- coverage;
- liability;
- cause of loss as legally final;
- reserve;
- indemnity;
- claim approval.

### Insurer/lender institutional verifier — ADOPT

Extend the existing Institutional Verifier so an authorised external institution can verify:

- dossier authenticity;
- current/superseded status;
- specific credential/checkpoint;
- source coverage;
- revocation/status;
- exact artifact checksum.

Verification must work without granting broad project access.

### External request / consent receipt — REQUIRED

Every institution-facing disclosure records:

- requesting organisation/identity;
- declared purpose;
- owner/authorised actor consent or legal basis class;
- requested profile;
- disclosed fields/documents;
- issued artifact/version;
- expiry;
- revocation;
- timestamp.

This prevents "institutional integration" from becoming silent bulk data access.

### Recall & Safety Impact Network — ADOPT

Build on Material Lot/Batch Traceability + Installed Asset Register + Product Provenance.

Source adapters may monitor:

- official government/regulator recall systems;
- admitted manufacturer/supplier notices;
- DPP/product-passport status updates;
- approved industry feeds.

Examples of jurisdictional official sources:

- EU Safety Gate;
- US CPSC recalls API;
- UK OPSS recalls/alerts.

### Recall identity matching — REQUIRED

Match alerts to installed products using strongest available identifiers:

1. exact serial/unique product identifier;
2. exact lot/batch;
3. GTIN/barcode/product code;
4. manufacturer + model;
5. structured product attributes;
6. visual/text similarity only as a **candidate discovery signal**.

A fuzzy/AI match cannot mark an installed asset as recalled.

### Recall Match object — ADOPT

Candidate fields:

- external alert/source ID;
- source/version/checksum;
- jurisdiction;
- risk/measure as reported by source;
- matched installed asset/material;
- match method;
- match confidence;
- reviewer;
- confirmed / rejected / unresolved;
- affected property/room;
- owner notification state;
- remediation/service link;
- current external status;
- last checked_at.

### Safety action flow — ADOPT

`external alert -> source admission -> candidate installed-product match -> review -> confirmed impact -> owner/property-manager notification -> service/inspection/replacement action -> completion evidence -> history event`

Never:

`external text similarity -> automatic panic notification -> automatic defect/payment/warranty decision`

### Recall blast-radius view — ADOPT

For an approved supplier/manufacturer/property manager:

- which properties contain the exact affected model/lot;
- which rooms/assets;
- current occupancy/contact routing subject to ACL;
- remediation status;
- unresolved cases;
- replacement evidence.

This can become a high-value portfolio capability.

### Historical source preservation — REQUIRED

If a product was installed under a source declaration valid at that time and a later recall/update occurs:

- retain original installation source/version;
- attach the later safety/recall event;
- never rewrite history to imply the later alert existed earlier;
- current safety state points to the latest admitted alert/status.

### Verified Building History checkpoint — ADOPT

Periodically or at key lifecycle boundaries issue a signed/versioned checkpoint over selected property-history state:

- handover;
- ownership transfer;
- insurer/lender disclosure;
- major restoration completion;
- major renovation completion.

Checkpoint includes:

- property history revision;
- included event/source roots;
- status/revocation endpoint;
- issuance policy/version.

This reuses the planned issuer/verifier/status-list infrastructure after #683/#668 admission is closed.

### OpenBIM / asset interoperability — ADAPT

Where IFC/BIM exists, link building-history events and installed assets to stable model/asset identifiers.

IFC remains an interchange/context layer.

A later model revision cannot silently erase Renova property-history events.

buildingSMART IFC/IDS/BCF can support:

- asset identity/context;
- required information checking;
- issue exchange;
- enduring built-asset information.

### Verified History Query examples

Future Project Intelligence should answer with citations:

- "Когда меняли электрику и кем она была принята?"
- "Какая версия системы отопления установлена сейчас?"
- "Какие работы были сделаны после страхового случая?"
- "Есть ли открытые гарантии или product recall по установленному оборудованию?"
- "Какие решения привели к текущей планировке?"
- "Что изменилось после последней передачи объекта?"
- "Какие факты в transfer dossier подтверждены Renova, а какие предоставлены владельцем?"

### Ownership transfer semantics — REQUIRED

A property transfer does not mean "change project.customer_id".

Model explicit lifecycle roles:

- historical owner;
- current owner/controller;
- delegated manager;
- service/warranty participant;
- institution with time-bounded disclosure access.

Historical attribution remains immutable.

New owner gains only explicitly transferred property-level records/capabilities.

Private project communications do not automatically transfer.

### Continuity after transfer — ADOPT

After verified ownership/control transfer:

- Property Passport continues;
- installed assets continue;
- maintenance history continues;
- transferable warranties can be represented as transferred only if source/terms support it;
- service history continues;
- prior owner private content remains separated;
- future work appends to the same property history through a new project/renovation episode where appropriate.

### Property identity — CONDITIONAL

Create a stable internal property identity distinct from any one renovation project.

Potential links:

`property -> renovation episode/project -> rooms/assets/history -> future renovation episode`

External cadastral/title identifiers may be referenced only when lawfully supplied/admitted.

Renova's internal property ID is not proof of legal title.

### Property episodes — ADOPT

Treat each renovation/restoration/service programme as an episode:

- episode type;
- project IDs;
- start/end;
- scope;
- participants;
- closeout;
- verified history checkpoint.

This lets one property accumulate trustworthy history across years without forcing one endless project.

### Privacy-preserving selective disclosure — ADAPT

For transfer/institutional verification, disclose only the minimum claims/evidence needed.

Where signed credential technology is used, evaluate selective-disclosure-compatible profiles only after standards/security review.

Default approach remains explicit server-side profile projection + bounded artifact manifest.

### Institutional interface contract — ADOPT

External integration should be profile-based:

- `property_transfer.v1`;
- `lender_evidence.v1`;
- `insurer_pre_loss.v1`;
- `insurer_claim_evidence.v1`;
- `property_history_verify.v1`;
- `recall_impact.v1`.

Every profile has:

- schema/version;
- purpose;
- field/data classification;
- minimum ACL/consent requirement;
- source/provenance semantics;
- expiry/retention;
- verification semantics.

Do not expose a generic "download everything" enterprise API.

### Commercial value

Potential products:

**Property Trust / Transfer**
- owner transfer dossier;
- buyer due-diligence workspace;
- property-manager onboarding;
- premium Verified Building History.

**Insurance**
- pre-loss baseline;
- claim/restoration evidence;
- recall/asset history;
- portfolio impact.

**Lender / valuation**
- owner-authorised renovation/condition evidence profile;
- verified history/checkpoints;
- interoperable partner API.

**Developer / property manager**
- portfolio building-history registry;
- installed-product/recall blast radius;
- maintenance/warranty continuity;
- institutional verification.

Revenue can come from:

- premium owner transfer package;
- enterprise verifier/API subscription;
- portfolio/property-management contract;
- insurer/lender integration;
- verification usage.

Never sell access to data a party is not entitled to receive.

### Competitive moat

The compounding asset is not a static PDF passport.

It is:

`property identity -> verified work/evidence -> installed products/assets -> decisions -> commissioning -> maintenance/warranty -> loss/restoration -> recall/safety -> transfer episodes -> signed checkpoints -> external verification`

Each legitimate future event increases the value of the historical graph.

### Acceptance

- transfer dossier is versioned and reproducible;
- current vs historical/superseded facts are explicit;
- property identity is distinct from legal title;
- new owner does not inherit private chats/payment/security data by default;
- insurer/lender views are purpose-scoped and consent/audit bound;
- Renova does not make insurance coverage, appraisal or lending decisions;
- recall fuzzy matching never auto-confirms installed-product impact;
- official/external source updates preserve historical source lineage;
- external verifier can validate artifact/current status without broad project access;
- property history remains usable without BIM, AI, EU DPP or smart-home integrations;
- jurisdiction-specific claims are never presented as globally valid.

**Sequencing:** stable Property identity/episodes -> verified building-history projection -> Transfer Dossier v2 -> institutional disclosure profiles -> recall/safety adapters -> signed history checkpoints -> insurer/lender partner adapters.

## Property resilience & emergency information wave — emergency-ready projection of verified property history

**Status:** CONDITIONAL / PROPERTY-CARE EXTENSION.

This is **not** a life-safety control system, fire-alarm system or emergency dispatch service.

It is a bounded emergency-information projection over the existing Property Passport / Installed Assets / Verified Building History so an owner, authorised manager or service technician can quickly find important property information during an incident.

Useful public preparedness references:

- FEMA / Ready.gov utility shut-off guidance:
  - https://www.fema.gov/pdf/areyouready/basic_preparedness.pdf
  - https://training.fema.gov/emiweb/is/is909/preparedness_handoutsmaster.pdf
  - https://www.ready.gov/resolution
- NFPA emergency-planning direction includes facility/layout information and locations of remote utility shutoffs where relevant.

### Emergency Property Card — ADOPT

Create a compact, owner-maintained/verified view containing only relevant available facts:

- property/entrance/unit identity;
- main water shut-off location;
- electrical distribution panel / main disconnect location;
- gas shut-off/service reference where applicable;
- heating/HVAC isolation reference;
- critical equipment;
- leak sensors / alarms where owner has admitted them;
- fire/smoke/CO equipment metadata where owner chooses to record it;
- access constraints important to authorised technicians;
- emergency/service contacts;
- last verified date;
- source/evidence references.

If a property does not have a system, display "not applicable" rather than inventing a value.

### Utility Shut-off Point object — ADOPT

Candidate fields:

- utility type;
- property/room/location;
- label/description;
- photo/plan pin;
- source;
- verified_by;
- verified_at;
- last inspection/test date where applicable;
- instructions reference;
- safety warning;
- current/superseded state.

Do not store unsafe generic "how to operate" instructions when operation is legally/safely restricted to a utility or qualified professional.

### Emergency floor-plan overlay — ADAPT

On authorised plan/spatial views, optionally show:

- shut-off points;
- electrical panel;
- key technical equipment;
- safe access route references;
- critical asset location.

This is an informational overlay, not an emergency-response command system.

### Offline emergency card — CONDITIONAL

For owner/manager devices, allow a deliberately selected minimal offline emergency card.

Requirements:

- explicit opt-in;
- minimum sensitive data;
- encryption/protected local storage where justified;
- visible last-sync timestamp;
- no private project/chat history;
- account/device revocation path.

Do not assume cloud access during utility/network outage.

### Property Emergency Share — ADOPT/CONDITIONAL

Generate a short-lived, owner-authorised share/profile for a trusted technician/property manager.

Possible scope:

- shut-off locations;
- equipment identity;
- relevant room/asset;
- warranty/service contact;
- current incident reference.

No ordinary project membership is created.

### Incident quick-capture — ADOPT

During a leak/electrical/HVAC/property incident:

`Emergency Card -> affected room/asset -> photo/video/reading -> incident record -> service/insurance workflow`

The emergency card accelerates context; the actual loss/service evidence continues through the existing incident/insurance/service domains.

### Resilience check reminders — ADAPT

Optional reminders for owner-defined checks such as:

- confirm shut-off location still accessible;
- update emergency contact;
- verify asset/service document;
- review battery/maintenance date where an admitted manufacturer/source schedule supports it.

Renova must not invent regulatory inspection intervals.

### Post-incident update — REQUIRED

After a renovation/service/restoration changes:

- utility location;
- panel/equipment;
- room geometry;
- critical asset;
- emergency contact;

the previous emergency-property information is superseded/versioned.

Never leave two current shut-off points without an explicit reason.

### Transfer / new-owner continuity — ADOPT

Emergency-property facts that are legitimately transferable may be included in Property Transfer Dossier v2.

Previous-owner personal contacts/private access information are excluded by default.

New owner confirms/re-verifies emergency contacts and access details.

### Property manager portfolio view — CONDITIONAL

For authorised managers:

- properties with missing emergency card;
- stale/unverified shut-off points;
- current active incidents;
- emergency/service contact completeness.

This is readiness/completeness information, not a certified compliance score.

### Safety boundary — REQUIRED

Renova must visibly state:

- call emergency services/utilities when required;
- do not enter unsafe areas;
- some utilities/equipment must only be operated/re-energised by qualified professionals;
- recorded information may be stale and includes a verification timestamp;
- Renova does not replace official evacuation/fire/gas/electrical instructions.

### Acceptance

- emergency information has source + last-verified timestamp;
- unavailable is distinct from verified absent;
- offline card is explicit/minimised;
- previous-owner private contacts do not transfer by default;
- emergency share is scope/expiry bound;
- Renova does not present a property as "safe" based on checklist completion;
- no sensor/alert automatically operates utility controls;
- official/local emergency instructions take precedence.

**Sequencing:** Property identity/history -> utility/equipment references -> Emergency Property Card -> plan overlay -> short-lived share/offline projection -> portfolio readiness view.

## Property Trust Matrix wave — explainable trust without a magic score

**Status:** PLANNED / HIGH-VALUE TRUST UX.

Do **not** introduce another opaque single-number "property score".

Renova already contains local operational/project health scores. Property trust is a different concept: it must describe **how well the property's history, evidence and current obligations are documented for a declared purpose**.

The core product is therefore:

`Property Trust Matrix -> deterministic Trust Posture -> dimension drill-down -> exact requirement -> exact source/evidence`

External conceptual references:

- EU Digital Building Logbook / renovation-passport guidance treats building logbooks as repositories for relevant building information that facilitate transparency, trust, informed decision-making and information sharing.
- buildingSMART IDS defines machine-readable information requirements that can be automatically checked.
- general data-quality frameworks distinguish dimensions such as completeness, consistency, timeliness, validity and accuracy and emphasise fitness-for-purpose rather than one universal quality number.

### Product principle — no universal composite score

Default UI must **not** show:

`Property Trust = 84/100`

A weighted average could hide a critical unresolved recall, missing transfer consent or unverified installed-system history behind strong scores elsewhere.

Instead show independent dimensions plus an overall deterministic posture.

### Core matrix dimensions — ADOPT

Universal candidate dimensions:

1. **History Coverage**
2. **Evidence Completeness**
3. **Maintenance Continuity**
4. **Source Freshness**
5. **Unresolved Risk & Obligations**
6. **Transfer Readiness**

Supporting trust dimensions/metadata:

7. **Provenance Strength / Verified Coverage**
8. **Verification Portability / Artifact Status**

The supporting dimensions may be shown separately rather than forced into every user-facing matrix.

### Requirement-policy basis — REQUIRED

Every scored dimension resolves to a versioned requirement policy.

A requirement contains:

- requirement_id;
- profile/purpose;
- applicability rule;
- importance/weight where needed;
- accepted evidence/source classes;
- freshness rule where applicable;
- blocker flag/severity;
- jurisdiction/organisation policy scope;
- effective_from / effective_to;
- policy version.

Examples:

- transfer profile requires a current ownership/control-authorisation receipt;
- an installed boiler may require commissioning and maintenance facts;
- a room with no maintainable assets has no maintenance requirement;
- an immutable historical acceptance record does not become stale merely because it is old.

### Applicable vs missing — REQUIRED

Do not treat "not applicable" as success and do not treat "unknown" as zero.

Every requirement result is one of:

- satisfied;
- partially_satisfied;
- missing;
- stale;
- conflicted;
- blocked;
- not_applicable;
- unknown / insufficient_data.

Only **applicable** requirements enter a dimension denominator.

### Coverage gate — REQUIRED

Before displaying a numeric dimension percentage, calculate:

`coverage = evaluated_applicable_requirements / applicable_requirements`

If coverage is below the policy minimum, show:

`Недостаточно данных`

instead of a misleading number.

A profile may define a minimum coverage threshold, but the threshold is part of the visible/versioned policy rather than hard-coded marketing logic.

### General dimension calculation pattern

Where a percentage is meaningful:

`dimension_percent = satisfied_requirement_weight / applicable_requirement_weight * 100`

Where:

- only applicable requirements enter the denominator;
- weights are declared in the policy;
- no hidden ML probability is used;
- partial satisfaction has an explicit policy factor if permitted;
- blocker semantics remain separate and cannot be averaged away.

Every UI score exposes:

- numerator;
- denominator;
- policy/version;
- coverage;
- blockers;
- source drill-down.

### 1. History Coverage — ADOPT

Question:

> "How much of the property's relevant lifecycle is actually documented?"

Possible requirement groups:

- renovation episodes;
- major accepted works;
- major decisions/changes;
- installed systems/assets;
- commissioning;
- restoration/loss episodes;
- ownership/control transfer episodes;
- warranty/service events;
- major replacement events.

Illustrative calculation:

`documented_applicable_history_requirements / applicable_history_requirements * 100`

Important:

- Renova does not invent an event merely because a category is empty;
- absence may mean "not applicable", "no known event" or "missing history";
- those states must remain distinct.

### 2. Evidence Completeness — ADOPT

Question:

> "Do the documented facts have the evidence required by the applicable policy?"

Reuse the governed evidence-requirement model.

Illustrative calculation:

`satisfied_required_evidence_items / applicable_required_evidence_items * 100`

Possible evidence:

- accepted photo/video;
- inspection result;
- source document;
- installation/commissioning record;
- material/product lot;
- signature/approval;
- as-built drawing;
- warranty/source reference.

Optional decorative media never increases required completeness.

### 3. Maintenance Continuity — ADOPT

Question:

> "Are maintainable installed assets being carried forward through their known maintenance/service obligations?"

Possible statuses:

- not yet due;
- completed on time;
- completed late;
- due soon;
- overdue;
- unknown schedule;
- source unavailable;
- not applicable.

Illustrative eligible ratio:

`satisfied_or_not_yet_due_maintenance_obligations / applicable_known_maintenance_obligations * 100`

If the property has no applicable maintainable assets, result is **N/A**, not 100.

A manufacturer-recommended maintenance interval must retain its source/version.

### 4. Source Freshness — ADOPT

Question:

> "Are time-sensitive facts still current enough for this purpose?"

Only time-sensitive source classes participate.

Examples:

- current warranty status;
- open recall/safety status;
- service-provider qualification where relevant;
- official certificate with expiry;
- transfer/disclosure consent;
- current maintenance state;
- external product/declaration status.

Historical immutable facts such as an accepted 2024 installation event do not become "stale" simply because years passed.

Each time-sensitive requirement defines a review/expiry rule.

Possible result:

`current_time_sensitive_requirement_weight / applicable_time_sensitive_requirement_weight * 100`

Stale source must show its last checked/verified timestamp.

### 5. Unresolved Risk & Obligations — ADOPT AS STATUS, NOT AVERAGE

Do **not** produce a cheerful percentage by subtracting arbitrary risk points.

Expose:

- critical unresolved;
- high;
- medium;
- overdue commitment;
- open defect/rework;
- open warranty/service issue;
- confirmed recall/safety action;
- unreviewed recall candidate;
- missing critical evidence;
- conflicting effective decisions/sources.

Default dimension status is derived from the **worst active applicable severity**, plus counts and age.

Example:

- `BLOCKED` — at least one profile-blocking critical item;
- `ACTION_REQUIRED` — unresolved high/overdue mandatory item;
- `ATTENTION` — medium/non-blocking issue;
- `CLEAR_FOR_DECLARED_SCOPE` — no unresolved applicable blocker known.

"Clear" means no known blocker in the declared/evaluated scope; it does not certify that the property is safe or defect-free.

### 6. Transfer Readiness — ADOPT

Question:

> "Can the declared transfer/due-diligence profile be issued without missing mandatory information/consent?"

Requirements depend on profile/jurisdiction.

Candidate requirements:

- current property/control authority for disclosure;
- transfer-approved building-history projection;
- current open issue/warranty disclosure;
- transferable installed-asset data;
- dossier manifest;
- privacy/redaction review;
- source/current-status check;
- explicit exclusions;
- verification artifact/status;
- required jurisdiction-specific records where configured.

Illustrative:

`satisfied_mandatory_transfer_requirements / applicable_mandatory_transfer_requirements * 100`

Any mandatory blocker forces posture `NOT_READY` regardless of percentage.

### 7. Provenance Strength / Verified Coverage — ADOPT

Question:

> "How much of the relevant matrix is supported by stronger source classes rather than declarations?"

Show distribution rather than one secret weighting:

- Renova accepted/observed;
- external official;
- qualified third-party;
- manufacturer/supplier declared;
- contractor declared;
- owner provided;
- derived;
- candidate/unverified.

Example:

`verified_or_official_requirement_weight / satisfied_applicable_requirement_weight * 100`

This prevents "100% complete" owner-entered data from looking equivalent to 100% independently supported evidence.

Do not claim that one authority class is universally superior for every fact; accepted classes are policy/purpose specific.

### 8. Verification Portability — ADOPT/CONDITIONAL

Question:

> "Can a third party verify the relevant issued artifact/current status without broad project access?"

Possible checks:

- current issued Property Trust artifact;
- canonical checksum/digest;
- issuer identity;
- signature verified;
- key/status valid;
- artifact not revoked/superseded;
- verification endpoint available;
- profile schema supported.

Before issuer/key/status infrastructure is qualified, show:

`NOT YET PORTABLY VERIFIED`

rather than simulating trust.

### Trust Posture — ADOPT

Overall posture is **deterministic**, not a weighted average.

Candidate states:

- `INSUFFICIENT_DATA`
- `INCOMPLETE`
- `ACTION_REQUIRED`
- `TRANSFER_READY_FOR_DECLARED_PROFILE`
- `VERIFIED_FOR_DECLARED_PROFILE`

Rules:

1. if mandatory coverage is below minimum -> `INSUFFICIENT_DATA`;
2. if a profile-blocking critical item exists -> `ACTION_REQUIRED`;
3. if mandatory profile requirements are missing -> `INCOMPLETE`;
4. if transfer requirements are complete but no portable verification is required/available -> `TRANSFER_READY_FOR_DECLARED_PROFILE`;
5. if the declared profile requires portable verification and all issuer/status requirements pass -> `VERIFIED_FOR_DECLARED_PROFILE`.

A stronger dimension cannot compensate for a failed mandatory gate.

### Purpose-specific matrix profiles — ADOPT

Do not show the exact same matrix to every party.

**Owner**
- history;
- evidence;
- maintenance;
- risks;
- next actions.

**Buyer / due diligence**
- history coverage;
- evidence/provenance;
- unresolved issues;
- transfer readiness;
- current source status.

**Property manager**
- maintenance continuity;
- warranty/service;
- emergency information freshness;
- recall/safety;
- portfolio gaps.

**Insurer / adjuster**
- pre-loss history coverage;
- installed asset/product provenance;
- maintenance/service;
- loss/restoration evidence;
- verification coverage.

**Lender / valuer**
- renovation history;
- evidence/source coverage;
- current major systems/assets;
- official certificate/passport references;
- transfer profile completeness.

No profile may turn Renova into an underwriting, appraisal or credit-scoring engine.

### Evidence age is not source quality — REQUIRED

Keep separate:

- source authority/provenance;
- source freshness;
- fact age.

An old historical acceptance can remain authoritative/current as a historical fact.

A recently uploaded owner declaration can be fresh but weakly verified.

### Conflict handling — REQUIRED

When sources conflict:

- do not silently choose whichever improves the score;
- mark the requirement `conflicted`;
- expose both sources/version/timestamps;
- route to review;
- exclude it from "verified" coverage until resolved according to policy.

### Unknown-property-history penalty — EXPLICIT

Do not infer that a property with little history is bad.

Show:

`History coverage: 24% — insufficient documented history`

not:

`Property trust: 24/100 — poor property`

Missing evidence is an information limitation, not proof of bad physical condition.

### Snapshot model — ADOPT

Every computed matrix is a versioned snapshot:

- property_id;
- profile/purpose;
- policy version;
- source cutoff;
- computed_at;
- matrix dimensions;
- coverage;
- requirement results;
- blockers;
- current/superseded state;
- optional signed artifact reference.

A historical matrix snapshot remains reproducible after later property events.

### Recompute triggers — ADOPT

Candidate triggers:

- accepted work/inspection;
- closeout;
- installed asset/material change;
- commissioning;
- warranty/service/maintenance;
- new/superseded decision;
- product recall/safety source update;
- source admission/revocation;
- transfer dossier issuance;
- ownership/control transfer;
- restoration/loss completion;
- policy/profile version change.

Use outbox/event-driven recomputation or invalidation; do not make every UI render recalculate the entire property history.

### Explainability / drill-down — REQUIRED

Every dimension row opens:

`dimension -> requirement groups -> exact requirement -> status -> why -> source/evidence -> next action`

Example:

`Maintenance continuity 67%`
-> 3 applicable known obligations
-> 2 satisfied/not-yet-due
-> 1 overdue
-> boiler annual service
-> source: manufacturer maintenance document v3
-> last service: 2025-08-12
-> next action: create service request

No score exists without this path.

### Trust improvement actions — ADOPT

Matrix is actionable.

Examples:

- "Add commissioning record";
- "Resolve conflicting installed-model identity";
- "Review stale warranty status";
- "Complete open inspection evidence";
- "Confirm recall candidate";
- "Re-verify emergency shut-off location";
- "Publish current transfer dossier";
- "Request official certificate/passport reference".

Renova should explain **how to improve information trust**, not gamify users into uploading meaningless documents.

### No gamification — REQUIRED

Reject:

- confetti for score improvement;
- competitive homeowner rankings;
- contractor pressure to maximise arbitrary trust points;
- incentives that reward quantity of uploaded evidence over required evidence quality.

### No underwriting / market-value inference — REQUIRED

Property Trust Matrix must not be represented as:

- property value;
- resale price;
- mortgage suitability;
- insurance eligibility;
- structural safety certification;
- credit score;
- legal title quality.

Institutions may use verified underlying data under their own policies; Renova exposes evidence, coverage and status.

### Visual contract — ADOPT

Avoid one giant circular score.

Preferred desktop/monitor view:

`Trust Posture + as-of/policy -> 6 dimension rows -> blockers/next actions -> evidence drill-down`

Each dimension row shows:

- label;
- deterministic status;
- percentage only where valid;
- coverage;
- data freshness where relevant;
- top blocker;
- "why" / drill-down.

Phone:

- posture;
- blockers;
- ordered dimension cards;
- next action;
- source detail.

A matrix/bar view is preferable to a radar/spider chart where precise comparison matters.

### Colour semantics — REQUIRED

Use text/icon/status plus colour.

Suggested semantic states:

- verified/current;
- ready;
- attention;
- action required;
- insufficient data;
- not applicable.

No red/green alone.

### Institutional comparison — ADOPT CAREFULLY

For a portfolio/property manager, compare:

- coverage;
- maintenance continuity;
- open critical obligations;
- transfer readiness;
- source freshness.

Do **not** rank properties from "best" to "worst" using a hidden composite.

Portfolio view should answer:

> "Which properties need action/data review?"

rather than:

> "Which building has the highest trust score?"

### Data-quality inspiration — REFERENCE

General data-quality dimensions such as completeness, consistency, timeliness, validity and accuracy are useful references.

Renova maps them into property-specific operational dimensions rather than copying them directly.

Examples:

- completeness -> History Coverage / Evidence Completeness;
- timeliness -> Source Freshness;
- consistency -> source-conflict detection;
- validity -> requirement/schema rules;
- accuracy -> only where reality can be independently checked;
- uniqueness -> stable property/asset/source identity controls.

### IDS / machine-checkable requirements — ADAPT

Where IFC/openBIM data is involved, buildingSMART IDS can express machine-checkable information requirements.

Renova may reuse IDS results as one source of evidence completeness for BIM/asset information.

IDS compliance is not the Property Trust Matrix itself.

### Commercial packaging — ADOPT

**Core owner**
- basic matrix;
- blockers;
- Property Passport readiness.

**Property Trust / Transfer premium**
- Transfer Readiness;
- Transfer Dossier v2;
- signed/current verification artifact when infrastructure exists;
- buyer due-diligence workspace.

**Enterprise**
- portfolio matrix;
- policy profiles;
- recall/safety portfolio gaps;
- maintenance/source freshness;
- institutional verification/API.

**Insurer/lender partner**
- purpose-specific evidence/coverage profile;
- no universal Renova composite score exported as underwriting input.

### Metrics for the matrix itself — ADOPT

Measure:

- percent of active properties with sufficient matrix coverage;
- median time to resolve critical information blocker;
- transfer-dossier preparation time;
- percentage of requirements with stronger source/provenance;
- stale-source resolution time;
- recall-candidate confirmation time;
- matrix drill-down/source-open rate;
- transfer due-diligence completion.

Do not optimise for average percentage alone.

### Anti-gaming checks — REQUIRED

Detect/guard against:

- duplicate evidence uploaded to satisfy multiple independent requirements where not valid;
- self-declared document replacing required inspection;
- stale source re-uploaded as "new";
- evidence from wrong room/project/asset;
- revoked/superseded source counted as current;
- excessive optional uploads inflating completeness;
- manual status change without required source.

### Acceptance

- no default universal weighted property score;
- each numeric dimension has explicit numerator/denominator/policy;
- insufficient coverage suppresses misleading percentages;
- not applicable is never counted as success;
- critical blockers cannot be averaged away;
- old historical facts are not penalised merely for age;
- provenance and freshness are separate;
- source conflicts remain visible;
- buyer/insurer/lender profiles cannot infer credit/value/coverage decisions from a Renova score;
- every matrix result drills down to canonical source/evidence;
- snapshots are reproducible/versioned;
- matrix works without AI;
- signed verification is optional until issuer/status infrastructure is real.

**Sequencing:** requirement-policy engine -> History/Evidence/Freshness dimensions -> risk/obligation status -> Transfer Readiness -> provenance coverage -> snapshot/UI -> institutional profiles -> signed verification.

## Property Action Engine wave — trust gaps to verified remediation

**Status:** PLANNED / OPERATIONAL LAYER OVER PROPERTY TRUST MATRIX.

Property Trust Matrix diagnoses information/obligation state.

Property Action Engine turns actionable findings into controlled remediation:

`requirement gap -> explanation -> responsible role -> proposed canonical action -> due/SLA policy -> required closure evidence -> domain execution -> verified closure -> Trust Matrix recompute`

It is **not** a second task/work-order/issue system.

Relevant reference patterns:

- ISO 55001:2024 defines requirements for systematic asset management across asset lifecycle, balancing performance, risk and expenditure and supporting continual improvement:
  - https://www.iso.org/standard/83054.html
- buildingSMART IDS defines machine-readable information requirements and automated checking:
  - https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/
- construction meeting/action tooling shows the operational importance of linking coordination items to actionable canonical work rather than leaving action points trapped in notes:
  - https://www.autodesk.com/learn/ondemand/course/construction-project-management/unit/1AvYkpc3Hj0xp6CZ10E6SL

### Core architecture — requirement remediation loop

`Trust Matrix Requirement Result`
-> `Action Recommendation`
-> human/policy triage
-> create/link **canonical domain action**
-> domain execution
-> closure evidence
-> canonical action completion/decision
-> requirement re-evaluation
-> new Trust Matrix Snapshot.

The Action Engine never marks a requirement satisfied merely because its recommendation was clicked "done".

### Action Recommendation object — ADOPT

A recommendation is an orchestration/projection object, not business authority.

Candidate fields:

- recommendation_id;
- property_id;
- matrix_snapshot_id;
- policy_id/version;
- requirement_id;
- dimension;
- reason_code;
- severity;
- blocking;
- explanation;
- responsible_role_class;
- suggested_canonical_action_type;
- suggested_target_entity;
- due_at / SLA source where applicable;
- required_closure_predicate;
- accepted_closure_evidence classes;
- current linked canonical entity reference;
- recommendation state;
- dedupe_key;
- first_detected_at;
- last_evaluated_at;
- supersedes / superseded_by.

### Recommendation states — ADOPT

Candidate states:

- proposed;
- acknowledged;
- linked_to_canonical_action;
- snoozed_until;
- dismissed_with_reason;
- invalidated;
- resolved_from_domain;
- superseded.

Do not duplicate the status of the linked Task/RFI/Inspection/Service Case/Issue.

Once linked, the canonical entity remains authoritative for execution status.

### Canonical action routing — REQUIRED

Map recommendation classes into existing Renova authorities.

Examples:

**Missing inspection evidence**
-> Inspection / Hold Point.

**Unresolved construction defect**
-> Project Issue / Punch / Work Order.

**Technical ambiguity**
-> RFI.

**Material/product approval gap**
-> Submittal / Material Approval.

**Maintenance overdue**
-> Service Case / Work Order.

**Warranty obligation**
-> Warranty Issue / Service Case.

**Recall confirmed on installed product**
-> Inspection / Service / Replacement action depending on approved policy.

**Missing transfer disclosure/source**
-> bounded Project/Property Task or document/source-admission action.

**Conflicting decision/source**
-> review task / Decision Ledger action.

If a canonical domain exists, do not create a generic task instead.

### Generic Property Task — BOUNDED

A generic Property Task is allowed only when no existing domain authority fits.

Use cases may include:

- request a missing transferable document;
- re-verify a property metadata fact;
- request owner consent/redaction review;
- confirm a source identity;
- administrative transfer preparation.

Generic task cannot represent:

- payment approval;
- acceptance;
- RFI response;
- inspection;
- warranty defect;
- change order;
- material approval

when a dedicated canonical domain exists.

### Dedupe / action identity — REQUIRED

Avoid recommendation spam.

Define a stable dedupe identity such as:

`property_id + policy_id/version class + requirement_id + subject_entity + source/current-state identity`

If the same underlying unresolved requirement is re-evaluated:

- update/retain the existing recommendation;
- do not create a new action every matrix recompute.

A materially changed root cause/source/policy may supersede the previous recommendation.

### Reopen semantics — REQUIRED

If a previously resolved requirement becomes unsatisfied again:

- do not silently mutate history;
- create a new recommendation occurrence or explicit reopen lineage according to policy;
- link to the previous resolved occurrence;
- preserve previous completion evidence.

Examples:

- maintenance becomes due again in a new service cycle;
- warranty/source expires;
- recalled replacement product is itself affected later;
- transfer consent expires;
- previously verified emergency shut-off point becomes invalid after renovation.

### Why-this-matters explanation — REQUIRED

Every recommendation explains:

- what requirement failed;
- why it applies;
- why it matters for the current purpose/profile;
- what source is missing/stale/conflicted;
- what is known vs unknown;
- whether it blocks transfer/verification;
- which action can resolve it.

Avoid generic messages like "Improve trust score".

Preferred:

> "Transfer dossier cannot be issued because the current boiler commissioning record is missing. Upload/verify the commissioning record or create an inspection/service action."

### Responsible-role policy — ADOPT

Requirement policy may declare candidate responsible roles:

- current owner/controller;
- contractor;
- supervisor/inspector;
- property manager;
- service provider;
- document/compliance administrator;
- insurer liaison;
- enterprise organisation administrator.

Assignment follows actual Renova ACL/team/provider rules.

The engine cannot grant project/property access merely because a role would ideally be responsible.

### Assignment fallback — REQUIRED

If the required role is unavailable:

- place recommendation in an explicit unassigned/owner-triage queue;
- identify missing capability/participant;
- optionally recommend inviting/assigning a qualified party.

Do not silently assign to an unrelated participant.

### SLA / due-date source — REQUIRED

Never invent an authoritative deadline.

Allowed due/SLA sources include:

- contract/warranty term;
- manufacturer maintenance schedule;
- official recall/remediation notice;
- approved organisation policy;
- service agreement;
- RFI/Submittal/inspection policy;
- owner-selected target;
- explicit regulatory/jurisdiction policy source.

If no valid due source exists:

- use priority without fabricated SLA;
- display `Срок не задан`.

Every deadline records:

- due_at;
- due_source_type;
- due_source_id/version;
- computed rule/version where calculated.

### Priority — ADOPT WITHOUT MAGIC SCORE

Default prioritisation should be deterministic bands, not a hidden numeric "AI priority score".

Candidate order:

1. immediate safety/official recall blocker;
2. profile-blocking critical requirement;
3. overdue mandatory obligation;
4. high severity / near due;
5. transfer/verification blocker;
6. medium attention;
7. documentation improvement.

Within a band sort by:

- due date;
- first detected;
- affected dependency/critical path;
- user-selected priority.

AI may explain priority; it does not silently reorder a critical mandatory action below optional cleanup.

### Closure predicate — REQUIRED

Every recommendation specifies **what actually closes the requirement**.

Examples:

**Missing commissioning**
- admitted commissioning record with accepted source class + required fields.

**Maintenance overdue**
- completed Service Case + required completion evidence + current maintenance cycle advanced.

**Stale warranty source**
- refreshed admitted warranty/current-status source.

**Confirmed recall**
- approved remediation outcome + replacement/inspection evidence + recall-action requirement resolved.

**Missing inspection evidence**
- completed/accepted Inspection Submission satisfying the governed evidence requirement.

**Transfer redaction review**
- authorised disclosure review completed for current dossier version.

"Task closed" by itself is not sufficient unless the requirement policy explicitly defines it.

### Closure evidence contract — ADOPT

A closure predicate may require:

- source/document;
- accepted inspection;
- service evidence;
- installed asset/product update;
- photo/video evidence;
- signature/approval;
- current external status check;
- Decision Ledger record;
- transfer consent/receipt;
- verification artifact.

Evidence source classes must match the requirement policy.

### Domain-event observation — ADOPT

The engine observes existing canonical events/outbox:

- Inspection completed/accepted;
- Issue/Work Order closed;
- RFI answered/accepted;
- Submittal approved;
- Service Case completed;
- Warranty Issue resolved;
- Source admitted/refreshed/revoked;
- Installed Asset changed;
- Decision superseded;
- Transfer dossier published/revoked.

Then it invalidates/re-evaluates affected requirements.

Do not have every screen poll/recompute the whole property graph.

### Recompute contract — REQUIRED

`canonical domain event -> affected requirement lookup -> requirement re-evaluation -> Trust Matrix Snapshot -> recommendation update`

Recompute must be:

- idempotent;
- retryable;
- version-aware;
- policy-aware;
- source-cutoff aware;
- observable.

A failed recompute cannot roll back the canonical business event that already committed.

### Eventual consistency UX — REQUIRED

After a canonical action completes:

- show business action as completed from its authority;
- Trust Matrix may briefly show "Пересчитываем";
- display snapshot/source cutoff timestamp;
- never fake immediate trust resolution before recompute.

### Action Bundles — ADOPT

Multiple requirements may be resolved by one canonical action.

Example:

A commissioned boiler service may resolve:

- overdue maintenance;
- stale service-status source;
- missing current service evidence;
- transfer-readiness maintenance blocker.

Represent:

`one canonical action -> many requirement bindings`

Do not create four duplicate service tasks.

### Bundle safety — REQUIRED

One action can close multiple requirements only when **each closure predicate independently passes**.

No blanket "bundle completed = all trust gaps solved".

### Dependency graph — ADAPT

Some actions depend on another action.

Examples:

- identify exact installed model -> then evaluate recall;
- obtain document -> then source admission review;
- RFI response -> then change review;
- repair -> then reinspection;
- replacement -> then commissioning/passport update.

Represent explicit dependencies:

- blocked_by;
- unlocks;
- prerequisite.

Avoid circular action dependencies; detect and surface them.

### Trust Recovery Plan — ADOPT

For a property/profile, generate an ordered **Recovery Plan**:

- current posture;
- blocking recommendations;
- non-blocking recommendations;
- responsible parties;
- known due dates;
- estimated action classes;
- which Trust Matrix dimensions/requirements each action can affect.

Do not promise the final percentage/posture until closure predicates are actually satisfied.

### Transfer Readiness Fast Path — ADOPT

When owner initiates transfer:

`current Transfer Readiness -> blocking gaps -> Recovery Plan -> execute/collect -> recompute -> issue Transfer Dossier`

This is a strong commercial workflow.

### Recall Remediation Fast Path — ADOPT

`official recall admitted -> confirmed asset match -> critical recommendation -> responsible owner/manager/provider -> inspection/service/replacement -> evidence -> asset/history update -> requirement re-evaluation`

Official recall severity/remedy remains source-labelled.

Renova cannot invent a different safety instruction.

### Maintenance Loop — ADOPT

`maintenance becomes due -> recommendation -> Service Case -> appointment/work -> completion evidence -> asset maintenance history -> next cycle -> matrix recompute`

This turns Property Passport into recurring operational value.

### Institutional Request Fast Path — ADOPT

For an insurer/lender/buyer profile request:

`requested profile -> evaluate purpose policy -> trust/coverage gaps -> owner actions -> consent/redaction -> recompute -> issue bounded artifact`

Institution cannot trigger arbitrary remediation actions against the property without owner/authorised policy.

### Notification policy — ADOPT

Notify only when actionability exists.

Examples:

- new critical blocker;
- due soon;
- overdue;
- assignment;
- source revoked;
- confirmed recall;
- transfer blocker after transfer flow started;
- resolved action requiring review/recompute.

Do not notify on every matrix percentage movement.

### Escalation — CONDITIONAL

Escalation rules may come from:

- contract/organisation SLA;
- official safety policy;
- warranty/service agreement;
- enterprise workflow.

Escalation can:

- notify supervisor/manager;
- reassign according to policy;
- surface on portfolio dashboard.

It cannot expand ACL or approve a business decision.

### Snooze / dismiss — REQUIRED

Users need control over non-critical recommendations.

**Snooze**
- reason;
- until date;
- actor;
- policy restrictions.

**Dismiss**
- explicit reason;
- allowed only if policy permits;
- may require privileged role;
- recommendation remains in history.

Critical/blocking actions may be non-dismissible.

Dismissal does not mark the underlying requirement satisfied.

### Waiver — GOVERNED

If a requirement can be formally waived:

- dedicated policy;
- authorised actor;
- waiver reason;
- supporting source;
- effective/expiry period;
- audit;
- visible matrix state.

Waiver is distinct from dismissal.

### Conflict handling — REQUIRED

If action execution creates a source conflict:

- requirement becomes conflicted;
- recommendation remains/reopens as needed;
- route to review;
- do not choose the "better scoring" source automatically.

### Offline behavior — ADAPT

Site/mobile user may:

- view cached recommendations;
- capture evidence;
- draft action updates;
- create permitted offline canonical mutation intents.

But:

- recommendation closure waits for server-confirmed canonical result;
- Trust Matrix recompute is server-authoritative;
- offline UI clearly shows queued/not-confirmed.

### AI role — BOUNDED

AI may:

- explain why a recommendation exists;
- summarise sources;
- suggest the most likely canonical action type;
- draft RFI/Service/Task text;
- bundle related recommendations as a proposal;
- prepare Recovery Plan narrative.

AI may not:

- mark requirement satisfied;
- override blocker;
- create high-risk action without review;
- change due-date source;
- waive requirement;
- close canonical action;
- fabricate evidence.

### Action Engine policy tests — REQUIRED

For every requirement/action mapping test:

- triggering gap;
- non-triggering satisfied case;
- N/A case;
- unknown/insufficient-data case;
- dedupe;
- source/policy version change;
- action creation/link;
- closure predicate positive;
- closure predicate negative;
- stale/superseded evidence;
- wrong-property evidence;
- reopen/new cycle;
- blocker precedence.

### Action audit receipt — ADOPT

Record recommendation lifecycle facts:

- recommendation ID;
- originating snapshot/requirement;
- generated policy/version;
- actor acknowledgement;
- canonical entity created/linked;
- completion event;
- closure evaluation;
- resulting matrix snapshot;
- dismiss/snooze/waiver events.

This is audit context, not a duplicate task history.

### Portfolio Action Queue — ADOPT

For property managers/enterprise:

Filter by:

- critical/blocking;
- overdue;
- recall;
- maintenance;
- source freshness;
- transfer preparation;
- unassigned;
- property;
- responsible role/provider.

Do not provide a single "portfolio action score".

### Outcome metrics — ADOPT

Measure:

#### Recommendation-to-action conversion

`recommendations_linked_to_canonical_action / actionable_recommendations`

#### Median time to acknowledgement

`acknowledged_at - first_detected_at`

#### Median remediation time

`requirement_resolved_at - first_detected_at`

#### Closure failure rate

Canonical action completed but closure predicate still fails.

This is especially important: it reveals "task closed without solving the trust gap".

#### Reopen rate

Requirement becomes unsatisfied again after prior resolution.

Segment legitimate recurring cycles (maintenance) separately.

#### Duplicate recommendation rate

Should approach zero for same unresolved root requirement.

#### Transfer blocker resolution time

From transfer flow start/gap detection to profile-ready state.

### Commercial packaging

**Core owner**
- critical blockers;
- maintenance/warranty next actions;
- basic Trust Recovery Plan.

**Property Trust / Transfer**
- full transfer-blocker workflow;
- dossier readiness;
- verification action path.

**Property Care**
- recurring maintenance/service action engine;
- provider/service network.

**Enterprise**
- portfolio action queue;
- organisation SLA/escalation;
- policy profiles;
- recall blast-radius remediation;
- institutional request workflow.

### Anti-patterns — REJECT

- parallel proprietary task statuses inside Trust Engine;
- "Mark trust gap solved" button without closure evidence;
- arbitrary AI-generated deadline;
- one task per dimension when one service/inspection resolves multiple requirements;
- repeated notifications every recompute;
- auto-waiver;
- auto-acceptance/auto-payment;
- recommendation score that hides critical blockers;
- property manager action that silently grants project access;
- action engine as direct SQL/domain-table writer.

### Acceptance

- each recommendation comes from a versioned matrix requirement/policy;
- each actionable recommendation maps to an existing canonical domain where available;
- recommendation status never replaces canonical action status;
- deadline/SLA provenance is visible;
- closure predicate is explicit/testable;
- completed canonical action does not guarantee trust resolution;
- one action can safely satisfy multiple requirements only through independent closure predicates;
- dedupe prevents recommendation spam;
- dismiss/snooze/waiver semantics are distinct;
- server-confirmed domain outcome triggers idempotent matrix recompute;
- AI cannot satisfy/waive/close requirements;
- offline actions remain pending until server confirmation;
- every resolved gap can be traced: requirement -> action -> evidence -> domain result -> new matrix snapshot.

**Sequencing:** requirement/action mapping registry -> recommendation projection -> canonical action bindings -> closure predicates -> recompute loop -> owner Recovery Plan -> maintenance/recall/transfer fast paths -> portfolio action queue -> bounded AI assistance.



---

# Property Intervention Optimizer — 2026-10-08

**Status:** ADOPT AS NEXT PLANNING LAYER AFTER PROPERTY ACTION ENGINE.  
**Contract:** `docs/RENOVA_PROPERTY_INTERVENTION_OPTIMIZER_CONTRACT_2026-10-08.md`

The Property Action Engine already answers which trust/maintenance/transfer gaps are actionable and what canonical evidence closes them. The next layer must optimise **how to recover efficiently without becoming execution authority**.

Core chain:

```
active blockers/actions
-> hard constraints + dependencies
-> critical path
-> provider capability / windows / sourced cost
-> Service Visit Bundling
-> what-if scenarios
-> explainable Recovery Plan
-> human approval
-> canonical execution
-> evidence
-> Trust Matrix recompute
```

## Adopt

- deterministic feasibility before any AI/learned optimisation;
- explicit hard constraints;
- mandatory criticality before efficiency objectives;
- target-profile critical path;
- Service Visit Bundling as a first-class primitive;
- independent closure predicates after every bundled visit;
- sourced cost/time/availability only;
- transparent alternatives instead of one opaque score;
- pinned human commitments;
- stale-plan detection before approval;
- partial-feasibility plans;
- plan-stability rules to avoid churn;
- explicit what-if scenarios;
- outage fallback to Action Engine/manual canonical execution.

## Service Visit Bundling — strategic differentiator

One qualified visit may address several requirements when constraints allow, for example:

- maintenance;
- installed-asset verification;
- commissioning/status refresh;
- evidence capture;
- selected transfer-readiness blockers.

The visit can be operationally bundled while the underlying canonical actions/evidence obligations remain separate.

This is intended to reduce repeat access, provider travel/setup and fragmented evidence collection **only where measured data later confirms the benefit**.

## Reject

- cheapest-plan-first logic;
- fabricated provider availability/cost/duration;
- auto-booking;
- AI override of hard constraints;
- one bundled completion flag closing many requirements;
- merging remediation and independent inspection when policy requires separation;
- claims of guaranteed savings/readiness;
- solver outage blocking required remediation.

## Sequencing

`Action Engine -> intervention graph -> hard constraints -> critical path -> Service Visit Bundling v1 -> what-if comparison -> approval/audit -> replan triggers -> pilot measurement -> advanced solver only if justified`.


---

# Property Operations Network — 2026-10-08

**Status:** ADOPT AS PORTFOLIO OPERATIONS LAYER AFTER INTERVENTION OPTIMIZER.  
**Contract:** `docs/RENOVA_PROPERTY_OPERATIONS_NETWORK_CONTRACT_2026-10-08.md`

The next layer extends property-level intervention planning into a real portfolio operating network:

```
portfolio
-> installed assets
-> service obligations
-> Asset / Service Demand Forecast
-> Provider Capability + Capacity Graph
-> Parts & Materials Availability
-> Portfolio Visit Routing
-> Maintenance Campaigns
-> Recall Blast-Radius Response
-> Predictive Recovery Planning
-> canonical execution/evidence
-> measured realised economics
```

## Core rules

- forecast is never execution authority;
- deterministic obligations remain distinct from probabilistic demand;
- provider capability, capacity, parts and travel data require provenance/freshness;
- unknown is never zero/available;
- routing inherits all Intervention Optimizer hard constraints;
- campaigns coordinate work but never bulk-close underlying obligations;
- recall candidate match is distinct from confirmed impact;
- scarce mandatory capacity is allocated by explicit policy, never opaque AI/customer-value ranking;
- savings require an explicit comparable baseline;
- forecast/quote/committed/actual/reconciled economics remain separate;
- network-layer failure cannot block canonical service/remediation.

## Highest-value first implementation

1. deterministic 30/60/90-day maintenance demand;
2. known qualified-provider capacity gaps;
3. parts readiness;
4. visit consolidation/routing;
5. maintenance campaign;
6. recall blast-radius workflow;
7. recovery capacity forecasting;
8. actual economics.

## Strategic moat

The long-term defensible graph is:

`installed asset + obligation + service history + provider capability + evidence quality + part dependency + actual cost/duration + repeat-visit outcome + trust/profile requirement`.

This is stronger than a generic scheduling or "AI facilities" layer because every recommendation remains traceable to real property facts, domain actions and evidence.


---

# Property Lifecycle Intelligence — 2026-10-08

**Status:** ADOPT AFTER PROPERTY OPERATIONS NETWORK DETERMINISTIC FOUNDATION.  
**Contract:** `docs/RENOVA_PROPERTY_LIFECYCLE_INTELLIGENCE_CONTRACT_2026-10-08.md`

Renova's next defensible layer should learn from **verified lifecycle history**, not from generic predictive-maintenance assumptions.

Core progression:

```
verified asset identity
-> lifecycle event ledger
-> deterministic actual-cost / service / downtime accounting
-> cohort eligibility + exposure
-> descriptive reliability benchmarks
-> Repair vs Replace scenarios
-> deterministic Lifecycle Cost / CapEx planning
-> historical backtesting
-> predictive reliability only after qualification
```

## Adopt first

- exact lifecycle event ledger;
- reconciled actual cost attribution;
- maintenance vs repair vs replacement semantics;
- downtime semantics;
- warranty-covered vs owner-paid economics;
- reproducible cohorts;
- observation/exposure denominators;
- censoring/survivorship handling;
- Repair vs Replace with explicit horizon;
- committed vs deterministic vs scenario vs predictive CapEx separation.

## Defer

- failure probability;
- predictive intervention windows;
- learned replacement timing;
- predictive CapEx.

These remain deferred until sufficient actual history, leakage-safe backtests, calibration, operational-threshold evaluation and drift monitoring exist.

## Reject

- universal asset-health score;
- predicted failure presented as fact;
- provider/manufacturer league tables from uncontrolled cohorts;
- lifespan claims derived only from replaced assets;
- quote/budget mixed with actual cost;
- theoretical warranty coverage called realised savings;
- automatic replacement/procurement.

## Strategic role

The durable lifecycle graph becomes:

`asset identity + installation context + maintenance + failure + actual cost + downtime + parts/replacement + provider evidence + warranty/recall + cohort exposure + outcome`.

This creates the foundation for credible lifecycle economics and later predictive reliability without sacrificing Renova's evidence-first architecture.


---

# Capital Planning & Asset Strategy Engine — 2026-10-08

**Status:** ADOPT AFTER DETERMINISTIC PROPERTY LIFECYCLE INTELLIGENCE.  
**Contract:** `docs/RENOVA_CAPITAL_PLANNING_ASSET_STRATEGY_ENGINE_CONTRACT_2026-10-08.md`

This layer converts evidence-backed lifecycle history into a governed long-horizon capital programme.

Core chain:

```
lifecycle evidence
-> mandatory / discretionary capital demand
-> 5/10-year CapEx plan
-> replacement waves
-> budget constraints
-> inflation/indexation
-> procurement lead times
-> provider/supplier capacity
-> business disruption
-> financing scenarios
-> transfer/refinancing targets
-> approved programme
-> execution
-> actual vs plan
```

## Adopt

- explicit CapEx maturity states;
- mandatory vs discretionary capital;
- 5-year deterministic plan first;
- 10-year strategy after baseline quality is proven;
- source-backed inflation/indexation;
- long-lead procurement model;
- Operations Network provider/supplier capacity;
- hotel/retail/office disruption calendars;
- replacement waves with per-asset justification;
- funding-gap scenarios;
- frozen approval baseline;
- actual/committed/approved/forecast variance;
- Decision Ledger integration.

## Boundaries

Renova remains a planning/operating system, not:

- general ledger;
- treasury;
- lender underwriting;
- property valuation;
- procurement award authority;
- board approval authority.

## Strategic value

The differentiated chain is:

`asset identity + lifecycle evidence + actual cost + capital obligation + supply/capacity + disruption + approved decision + realised outcome`.

This extends Renova from property operations into evidence-backed capital asset management without sacrificing the existing authority boundaries.


---

# Portfolio Strategy & Investment Committee OS — 2026-10-08

**Status:** ADOPT AFTER CAPITAL STRATEGY FOUNDATION AND RELIABLE ACTUAL-VS-PLAN HISTORY.  
**Contract:** `docs/RENOVA_PORTFOLIO_STRATEGY_INVESTMENT_COMMITTEE_OS_CONTRACT_2026-10-08.md`

This is the owner/committee governance layer above capital planning.

Core chain:

```
portfolio objectives
-> hold / improve / reposition / prepare_for_transfer / dispose_candidate
-> property fact packs
-> capital / lifecycle / operating evidence
-> allocation constraints
-> portfolio scenarios
-> committee pack
-> approval / conditions
-> programmes
-> execution evidence
-> actual outcome
-> strategy review
```

## Adopt

- explicit/versioned portfolio objectives;
- evidence-backed property strategy posture;
- portfolio scenario snapshots;
- hard capital constraints before optimization;
- mandatory funding-gap visibility;
- source-traceable committee packs;
- quorum/delegated-authority policies where configured;
- conditional approval;
- Decision Ledger linkage;
- frozen approved strategy baseline;
- decision delta / strategy supersession;
- outcome tracking.

## Boundaries

Renova must not become:

- investment adviser;
- property valuation/appraisal authority;
- lender underwriting engine;
- treasury;
- autonomous buy/sell/hold allocator.

## Strategic differentiation

The durable record becomes:

`property facts + owner objective + alternatives + approved decision + capital programme + execution evidence + actual outcome`.

This gives the owner not only a history of the asset, but a history of **why capital and strategic decisions were made and whether they worked**.
