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

