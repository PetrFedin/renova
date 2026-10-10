# Renova — Property Trust Exchange Profiles

**Date:** 2026-10-07  
**Status:** RESEARCH / INTEROPERABILITY CONTRACT  
**Implementation gate:** after #683 admission and #668 Verified Execution Record requalification.

## 1. Purpose

Define bounded external profiles for property-transfer and institutional verification use cases without exposing Renova's internal database schema.

Profiles are projections over canonical Renova authorities.

They are:

- purpose-scoped;
- versioned;
- least-privilege;
- consent/legal-basis bound;
- source/provenance aware;
- revocable/expirable where appropriate;
- independently verifiable.

## 2. Shared envelope

Every profile should share a minimal envelope.

```json
{
  "profile": "property_transfer.v1",
  "profile_version": "1.0",
  "artifact_id": "opaque-id",
  "issued_at": "RFC3339",
  "expires_at": "RFC3339-or-null",
  "issuer": {
    "type": "renova",
    "id": "issuer-id",
    "verification_method": "reference"
  },
  "subject": {
    "property_id": "opaque-property-id"
  },
  "scope": {},
  "sources": [],
  "payload": {},
  "status": {
    "url": "verification/status reference",
    "state": "current"
  }
}
```

This is illustrative shape, not a final API schema.

## 3. Shared source reference

Every material fact should be able to resolve to a source reference:

- source_type;
- source_id;
- source_version;
- checksum/digest where available;
- authority class;
- issued/effective timestamp;
- current/superseded/revoked state;
- optional verification reference.

## 4. Authority classes

Recommended values:

- `renova_accepted`;
- `renova_observed`;
- `external_official`;
- `owner_provided`;
- `contractor_declared`;
- `manufacturer_declared`;
- `supplier_declared`;
- `derived`;
- `candidate_unverified`.

External consumers must not treat all classes as equivalent.

## 5. property_transfer.v1

### Purpose

Owner-authorised handover/resale/management-transfer dossier.

### Candidate payload

- property summary;
- renovation episodes;
- major accepted works;
- installed rooms/assets;
- selected installed products/materials;
- commissioning;
- transferable warranty;
- maintenance;
- known open issues;
- selected decisions/changes;
- inspection/quality summary;
- selected drawings/as-built references;
- approved Property Passport records;
- admitted DPP/DoPC/EPD references;
- product recall/safety current state;
- official energy/renovation-passport references where available;
- verification manifest.

### Default exclusions

- private chats/messages;
- payment/bank requisites;
- contractor/customer private notes;
- hidden pricing/commercial negotiation;
- security/authentication data;
- unrelated personal information;
- insurer/lender restricted records;
- deleted/revoked content not legally retained for transfer.

## 6. property_history_verify.v1

### Purpose

Allow a verifier to confirm that a bounded history statement/checkpoint is authentic/current.

### Candidate payload

- property ID;
- history revision/checkpoint;
- included episode roots;
- included source Merkle/digest roots where implemented;
- issuance time;
- current/superseded/revoked state;
- verification policy/version;
- optional minimal summary.

Do not require broad property read access.

## 7. insurer_pre_loss.v1

### Purpose

Owner-authorised pre-loss evidence baseline.

### Candidate payload

- property/room structure;
- installed asset/product register;
- accepted prior renovation works;
- commissioning/maintenance;
- selected pre-loss media/evidence;
- warranties;
- major prior loss/restoration history where transferable;
- verification coverage.

### Explicit boundary

No insurance coverage opinion.

## 8. insurer_claim_evidence.v1

### Purpose

Bounded loss/restoration evidence package.

### Candidate payload

- loss event identity/reference;
- affected rooms/assets;
- pre-loss baseline references;
- captured damage evidence;
- restoration estimate/scope;
- work/evidence;
- inspections;
- accepted restoration;
- current asset/product state;
- manifest/checksums.

### Explicit boundary

No liability, cause-of-loss legal determination, reserve or claim approval.

## 9. lender_evidence.v1

### Purpose

Owner-authorised renovation/property-condition evidence for a lender/valuer partner.

### Candidate payload

- property identity/context;
- completed renovation episodes;
- accepted major work;
- room/area facts where authoritative;
- installed major systems/assets;
- selected drawings/floor plans;
- major condition/restoration facts;
- official energy/renovation-passport references;
- verified execution checkpoints;
- source coverage/freshness.

### Explicit exclusions

Renova does not issue:

- market value;
- credit decision;
- lending eligibility;
- licensed appraisal opinion.

## 10. recall_impact.v1

### Purpose

Portfolio/property verification of confirmed product-recall impact.

### Candidate payload

- official/admitted recall alert reference;
- source/version;
- affected product/model/lot identifiers;
- confirmed matched installed assets;
- properties/rooms subject to current actor scope;
- remediation state;
- owner-notification state;
- replacement/service evidence.

Fuzzy candidates are not exported as confirmed impact.

## 11. disclosure receipt

Every issued external profile records:

- request ID;
- requester organisation/identity;
- purpose;
- legal-basis/consent class;
- property/project scope;
- requested profile;
- included categories;
- excluded categories;
- issued artifact ID/version;
- expiry;
- revocation;
- actor authorising disclosure;
- timestamp.

## 12. Purpose limitation

A profile issued for:

`buyer_due_diligence`

must not automatically become valid for:

`insurance_claim`

or:

`lender_underwriting`.

Reissue under the correct profile/purpose where needed.

## 13. Expiry and current-state semantics

Not every history fact expires, but an issued package can become stale.

Profile should indicate:

- issued_at;
- source_cutoff;
- current-status check URL/reference;
- expires_at where justified;
- superseded_by;
- revoked state.

A verifier should be able to determine:

"artifact valid as issued" vs "artifact reflects current state".

## 14. Redaction

Redaction policy operates before artifact issuance.

Possible transformations:

- omit field;
- coarse date;
- generalise location;
- remove personal identity;
- suppress commercial values;
- replace direct source document with verification reference.

Redacted derivative retains policy/version metadata.

## 15. File manifest

For included files/evidence:

- logical file ID;
- filename/type;
- checksum;
- source/version;
- size;
- redaction/derivative class;
- original/derived state;
- verification URL where supported.

Do not sign a ZIP alone without an internal manifest.

## 16. Signed artifact

When issuer infrastructure is ready:

`canonical profile payload -> canonical encoding -> digest -> signature -> status/revocation reference`

Algorithm/key policy belongs to the issuer lifecycle architecture, not this profile document.

## 17. Selective disclosure

Default implementation:

- server-side profile projection;
- minimum fields;
- bounded artifact;
- explicit purpose.

Advanced selective-disclosure credentials are a later interoperability option, not a dependency.

## 18. Access modes

### Interactive workspace

Time-bounded portal/session for human due diligence.

### Portable artifact

Signed/manifested package.

### Verification API

Minimal authenticity/current-state checks.

### Partner API

Scoped institution integration under contract.

Each mode shares the same profile semantics.

## 19. Institution mapping adapters

Mapping adapters may translate a Renova profile into:

- ACORD-compatible insurance partner messages;
- MISMO-compatible property/valuation partner structures;
- openBIM/IFC references;
- national renovation-passport/logbook fields.

The adapter never becomes internal authority.

## 20. Error semantics

External API must distinguish:

- `not_found`;
- `not_authorized`;
- `expired`;
- `revoked`;
- `superseded`;
- `source_unavailable`;
- `coverage_incomplete`;
- `verification_unavailable`.

Do not return fabricated empty success data when source dependencies are unavailable.

## 21. Coverage block

Every institutional profile should be able to expose a coverage summary.

Example dimensions:

- renovation history;
- installed assets;
- commissioning;
- inspection/quality;
- warranty/service;
- product provenance;
- recall/safety;
- energy/passport references;
- source verification freshness.

Values should distinguish:

- complete for declared scope;
- partial;
- unavailable;
- not applicable.

## 22. Privacy and minimisation

Required:

- least data needed for purpose;
- no raw auth secrets;
- no unrelated chats;
- no bulk personal contacts;
- no unrestricted property history dump;
- expiry/revocation for temporary disclosure;
- audit trail of institutional access.

## 23. Ownership transfer

A transfer profile does not itself transfer Renova account ownership.

Canonical ownership/control transfer remains a separate governed process.

Artifact issuance may precede or follow ownership change.

## 24. Conformance tests

Every profile version should include test fixtures for:

- valid minimal payload;
- valid full payload;
- omitted optional data;
- partial coverage;
- superseded source;
- revoked source;
- redacted payload;
- expired artifact;
- restricted-field exclusion;
- checksum mismatch;
- unauthorized profile request.

## 25. Definition of Done

A profile is implementation-ready only when:

- purpose and exclusions are explicit;
- ACL/consent path is defined;
- source/provenance mapping is defined;
- machine-readable schema exists;
- example fixtures exist;
- expiry/status/revocation semantics exist;
- audit receipt exists;
- no profile invents legal/financial/insurance authority Renova does not possess.
