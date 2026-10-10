# Renova — Verified Property Network & Institutional Protocol

**Date:** 2026-10-08  
**Status:** RESEARCH / OPEN INTEROPERABILITY PROTOCOL CONTRACT  
**Implementation gate:** after External Institutional Network pilot flows, issuer lifecycle/status infrastructure, and stable Trust Exchange profile semantics are qualified.  
**Depends on:** Property Trust Exchange Profiles, External Institutional Network, Owner Digital Twin, issuer/key/status architecture, signed checkpoints, verification receipts.  
**Authority rule:** this protocol defines interoperable envelopes, identifiers, manifests, requests, verification and conformance. It does not confer legal title, valuation authority, lending/insurance approval, audit authority, or professional certification beyond declared conformance scope.

## 1. Purpose

The Verified Property Network Protocol turns Renova's internal evidence architecture into a publicly documentable interoperability layer.

Core chain:

```
property identity
-> evidence manifest
-> issuer identity
-> purpose/request profile
-> signed artifact/checkpoint
-> verification endpoint
-> status/revocation
-> conformance suite
-> reference implementation
-> SDK
-> external issuer onboarding
-> reusable interoperable evidence
```

The protocol should allow a compliant external system to issue or verify Renova-compatible property evidence without requiring internal Renova database access.

## 2. Design goals

The protocol should be:

- evidence-first;
- purpose-scoped;
- source-traceable;
- versioned;
- deterministic where signatures/hashes require it;
- privacy-preserving by default;
- implementation-neutral;
- transport-neutral where practical;
- extensible without breaking old verifiers;
- interoperable with relevant standards through adapters;
- usable without blockchain.

## 3. Non-goals

The protocol is not:

- a property title registry;
- a cadastral standard;
- a valuation model;
- a lending standard;
- an insurance decision standard;
- a general BIM replacement;
- a payments protocol;
- a universal identity system;
- a blockchain requirement.

## 4. Protocol layers

### Layer A — identity
- property identifiers;
- entity identifiers;
- issuer/verifier identifiers;
- profile identifiers.

### Layer B — evidence
- source/evidence metadata;
- manifests;
- digests;
- provenance;
- coverage.

### Layer C — request/disclosure
- purpose;
- scope;
- requested profile;
- authorisation/consent metadata;
- disclosure receipt.

### Layer D — signed artifacts/checkpoints
- canonical payload;
- signatures;
- issuer metadata;
- status references.

### Layer E — verification
- authenticity;
- status;
- supersession;
- freshness;
- minimal verification response.

### Layer F — conformance
- fixtures;
- validators;
- reference implementation;
- SDKs;
- certification.

## 5. Namespace

Reserve a stable namespace for protocol identifiers.

Illustrative identifiers:

- `renova:property:`
- `renova:issuer:`
- `renova:profile:`
- `renova:artifact:`
- `renova:checkpoint:`

Exact URI/URN scheme must be chosen before public release.

Avoid embedding mutable business state directly in identifiers.

## 6. Property identity model

A property identity envelope may contain:

- protocol property ID;
- external registry/cadastral references where lawfully available;
- issuer namespace;
- jurisdiction;
- address/location representation;
- building/unit relationship;
- identity status;
- source references;
- supersession/merge/split lineage.

Protocol identity does not claim legal title.

## 7. Identity confidence / authority

Identity claims may be typed:

- registry-backed;
- owner-attested;
- institution-attested;
- system-derived;
- unverified.

Verifier must be able to distinguish them.

## 8. Property split / merge / rename

Identity lineage supports:

- alias;
- rename;
- split;
- merge;
- unit renumbering;
- ownership transfer without identity replacement where appropriate.

Historical artifact verification must remain possible.

## 9. Issuer identity

Issuer metadata includes:

- issuer ID;
- legal/display name;
- issuer type;
- jurisdiction;
- public verification metadata;
- signing key references;
- supported profiles;
- status endpoint;
- conformance claims.

Issuer metadata itself must be versioned/status-aware.

## 10. Issuer types

Examples:

- Renova;
- property owner/operator;
- qualified contractor;
- inspection body;
- manufacturer;
- warranty administrator;
- technical DD provider;
- valuer;
- insurer;
- lender;
- auditor;
- public authority;
- other credentialed issuer.

Issuer type never automatically grants authority for all claim classes.

## 11. Claim authority registry

Define which issuer classes may author which claim types.

Examples:

- contractor -> service completion evidence;
- manufacturer -> warranty/recall/product identity;
- inspection body -> inspection result;
- valuer -> valuation report reference;
- lender -> process/checkpoint receipt;
- owner -> disclosure authorisation.

Authority mapping is policy/versioned.

## 12. Evidence object

Minimum evidence metadata:

- evidence_id;
- evidence_type;
- subject;
- issuer/source;
- issued/created timestamp;
- effective period;
- source version;
- digest;
- media/file references;
- original/derived status;
- supersedes/superseded_by;
- admission/verification state where relevant.

## 13. Evidence manifest

A manifest groups related evidence.

Required concepts:

- manifest_id;
- subject scope;
- profile;
- entries;
- per-entry digest;
- aggregate/canonical digest;
- redaction/derivative markers;
- source cutoff;
- generated_at.

Do not sign an opaque archive without an internal manifest.

## 14. Canonical encoding

Signable protocol objects require deterministic canonical bytes.

Candidate requirements:

- stable field ordering;
- explicit UTF-8;
- normalized timestamps;
- normalized numeric representation;
- prohibited ambiguous NaN/Infinity values;
- explicit omission/null semantics;
- deterministic arrays where order is semantic.

Choose a standardized canonicalization scheme where practical.

## 15. Digest policy

Protocol must declare:

- permitted digest algorithms;
- algorithm identifier;
- canonical input;
- output encoding;
- migration/deprecation policy.

Do not hard-code one algorithm forever without agility.

## 16. Signature envelope

Signed artifact/checkpoint includes:

- payload/profile ID/version;
- digest;
- signature algorithm;
- key ID;
- issuer ID;
- signed_at;
- status reference;
- optional certificate/credential chain reference.

Detached signatures should be supported where useful.

## 17. Signature algorithm agility

Protocol governance defines:

- allowed algorithms;
- deprecated algorithms;
- migration windows;
- verifier behaviour.

Historical artifacts may remain verifiable with retired verification-only keys.

## 18. Key discovery

Potential interoperable mechanisms:

- JWKS;
- X.509/certificate chain;
- DID document;
- signed issuer metadata.

At least one simple baseline mechanism should be mandatory.

## 19. Key lifecycle

States:

- active;
- rotate_scheduled;
- retired_verify_only;
- compromised;
- revoked.

Issuer metadata exposes enough history for old artifact verification.

## 20. Status model

Objects may have:

- current;
- suspended;
- expired;
- revoked;
- superseded.

Status semantics must be explicit per object type.

## 21. Status endpoint/list

Baseline requirements:

- stable object/status identifier;
- freshness/updated_at;
- cache policy;
- cryptographic authenticity where appropriate;
- unavailable semantics.

Verifier must distinguish "status service unavailable" from "current".

## 22. Supersession

A newer artifact may supersede an older one without invalidating the historical signature.

Verifier should distinguish:

- authentic_as_issued;
- current;
- superseded;
- revoked.

## 23. Profile identity

Profiles use stable IDs and semantic versions.

Example:

`lender_evidence.v1`

Public protocol should define:
- profile ID;
- major/minor version;
- purpose;
- required fields;
- optional fields;
- exclusions;
- freshness rules;
- conformance fixtures.

## 24. Profile compatibility

Rules:

- minor additive changes should remain backward compatible when possible;
- major semantic/breaking change requires new major version;
- verifier may declare supported versions;
- unsupported profile must return explicit error.

## 25. Request object

Normative request fields:

- request_id;
- requester;
- representative/service;
- purpose;
- profile/version;
- subject scope;
- requested fields/categories;
- legal-basis/consent metadata;
- valid_from/expires_at;
- callback/response mode;
- nonce/idempotency;
- signature metadata where signed.

## 26. Disclosure receipt object

Normative receipt includes:

- request reference;
- authorising party;
- approved purpose/scope;
- included categories;
- excluded categories;
- artifact/data-room reference;
- issued_at;
- expires_at;
- revocation reference.

## 27. Verification receipt object

Normative receipt includes:

- verifier;
- artifact/checkpoint;
- digest;
- verification time;
- issuer validation;
- signature result;
- status result;
- source cutoff;
- verifier software/protocol version.

## 28. Transaction checkpoint object

Checkpoint fields:

- checkpoint_id;
- workflow/transaction reference;
- parties;
- purpose/profile;
- artifact/snapshot;
- state;
- issued_at;
- effective_at;
- expires_at;
- evidence digest;
- optional countersignature/receipt references.

## 29. Protocol error model

Normative errors include:

- invalid_request;
- unsupported_protocol_version;
- unsupported_profile;
- not_authorized;
- purpose_mismatch;
- not_found;
- expired;
- revoked;
- superseded;
- signature_invalid;
- issuer_untrusted;
- status_unavailable;
- source_unavailable;
- coverage_incomplete;
- replay_detected;
- schema_invalid.

## 30. HTTP baseline

Reference HTTP API should define:

- content types;
- version headers;
- idempotency;
- request IDs;
- pagination where required;
- retries;
- rate-limit semantics;
- cache behaviour;
- ETag/content digest where useful.

## 31. Verification API baseline

A minimal verifier API should accept:

- artifact/checkpoint or ID;
- optional expected profile;
- optional expected issuer.

Returns:

- authenticity result;
- issuer;
- profile/version;
- issued_at;
- status;
- current/superseded/revoked;
- source cutoff;
- errors.

It should not disclose hidden payload fields.

## 32. Offline verification

Portable artifacts should include enough metadata for:

- signature verification;
- issuer/key discovery reference;
- manifest verification.

Current revocation/status may still require online access.

## 33. Transport independence

Protocol objects should work over:

- HTTPS API;
- file/package exchange;
- secure data room;
- message/event transport.

Business semantics should not depend on one transport.

## 34. Webhook/event profile

Standard events:

- request.created;
- request.approved;
- artifact.issued;
- artifact.revoked;
- artifact.superseded;
- checkpoint.issued;
- verification.completed;
- question.created;
- issuer.status_changed.

Events require replay protection and versioning.

## 35. Privacy baseline

Protocol conformance requires:

- purpose limitation;
- data minimisation;
- explicit scope;
- no unrelated personal data;
- expiry/status where applicable;
- auditability;
- redaction support.

## 36. Selective disclosure baseline

Baseline protocol supports server-side selective projection.

Advanced cryptographic selective disclosure may be added later as an optional profile.

Do not make advanced credential cryptography mandatory for v1.

## 37. Redaction semantics

Every derived/redacted item records:

- source reference;
- transformation policy/version;
- fields removed/generalised;
- derived digest;
- relationship to original.

Verifier can confirm derivative integrity without receiving hidden fields where design allows.

## 38. Coverage block

Profiles may include standardized coverage states:

- complete_for_scope;
- partial;
- unavailable;
- not_applicable;
- stale.

Coverage never implies physical condition quality.

## 39. Freshness

Objects expose:

- issued_at;
- effective_at;
- source_cutoff;
- verified_at;
- expires_at;
- freshness policy.

Verifier decides current suitability according to receiving policy.

## 40. External issuer publishing

A compliant external issuer may publish directly into the ecosystem if:

- issuer identity is registered/trusted;
- claim authority matches;
- profile/schema conforms;
- signatures validate;
- status endpoint works;
- privacy/purpose rules apply;
- conformance suite passes.

Renova need not re-author valid external evidence.

## 41. External issuer admission

Admission stages:

1. issuer application;
2. identity verification;
3. claim-authority mapping;
4. key/status setup;
5. sandbox conformance;
6. profile fixtures;
7. security review;
8. production activation;
9. continuous status/conformance monitoring.

## 42. Issuer suspension/revocation

If issuer is suspended:

- new issuance may stop;
- historical artifacts remain marked with issuer status context;
- verification policy decides acceptability;
- affected owners/institutions can be notified where required.

## 43. External verifier compatibility

A verifier need not trust Renova blindly.

It can configure:

- accepted issuers;
- accepted profiles;
- freshness;
- algorithm policy;
- claim authority;
- required coverage.

## 44. Conformance levels

Potential levels:

### Core Object Conformance
Schemas/canonicalization/digests.

### Issuer Conformance
Signing/status/issuer metadata.

### Verifier Conformance
Signature/status/profile evaluation.

### Exchange Conformance
Requests/disclosures/receipts.

### Transaction Conformance
Checkpoints/multi-party flows.

Certification should state exact tested level/version.

## 45. Conformance suite

Public suite should contain:

- valid objects;
- invalid schemas;
- canonicalization fixtures;
- signature fixtures;
- revoked/suspended status;
- supersession;
- expired profiles;
- redaction;
- replay attempts;
- unknown issuer;
- unsupported version;
- purpose mismatch;
- multi-party isolation cases.

## 46. Machine-readable schemas

Publish schemas for:

- property identity;
- issuer metadata;
- evidence;
- manifest;
- request;
- disclosure receipt;
- verification receipt;
- checkpoint;
- status response;
- error response.

Candidate format: JSON Schema / OpenAPI-compatible definitions.

## 47. Reference implementation

Provide a minimal open reference implementation for:

- canonicalize;
- hash;
- sign;
- verify;
- resolve issuer metadata;
- check status;
- validate profile/schema;
- verify manifest.

Reference implementation is not production security certification by itself.

## 48. Reference verifier

A small verifier CLI/service should support:

`verify artifact.json`

and return:

- schema status;
- digest status;
- signature status;
- issuer;
- profile;
- status;
- supersession;
- source cutoff.

## 49. Reference issuer

A sandbox issuer implementation should:

- generate test key;
- publish metadata;
- issue synthetic artifact;
- revoke/supersede artifact;
- expose status.

Use synthetic data only.

## 50. SDK strategy

Candidate SDKs:

- TypeScript;
- Python;
- Java/Kotlin;
- C#/.NET;
- optional Go.

Start with the languages real pilot partners require.

## 51. SDK responsibilities

SDKs should handle:

- schemas/types;
- canonicalization;
- digest/signature helpers;
- verification;
- status lookup;
- request/receipt construction;
- profile validation.

Do not bury business-policy decisions inside SDK defaults.

## 52. CLI tools

Potential tools:

- `renova-protocol validate`
- `renova-protocol sign`
- `renova-protocol verify`
- `renova-protocol manifest`
- `renova-protocol status`
- `renova-protocol conformance`

## 53. Public documentation

Documentation should include:

- protocol overview;
- threat model;
- normative schemas;
- versioning;
- signature/status;
- profile registry;
- examples;
- conformance;
- issuer onboarding;
- verifier guide;
- privacy guidance;
- migration guide.

## 54. Normative vs informative text

Public spec must distinguish:

- MUST;
- MUST NOT;
- SHOULD;
- MAY;

from informative examples.

Use RFC-style normative language consistently.

## 55. Protocol versioning

Separate:

- core protocol version;
- object schema versions;
- profile versions;
- conformance suite version.

Do not force a full protocol major bump for every profile addition.

## 56. Compatibility matrix

Publish matrix:

- verifier version;
- protocol versions;
- supported profiles;
- algorithms;
- status mechanisms.

## 57. Extension registry

Define namespaced extensions:

- vendor extensions;
- national fields;
- institution-specific fields.

Extensions must not redefine core semantics.

## 58. Profile registry

Public registry includes:

- profile ID;
- purpose;
- current version;
- schema;
- example;
- conformance fixtures;
- status;
- deprecated versions.

## 59. Issuer registry

Depending on governance model, public metadata may include:

- issuer ID;
- type;
- supported claim classes;
- metadata URL;
- status;
- conformance level.

Private/contracted issuers may use federated registries.

## 60. Federation

Protocol should allow multiple trusted registries/roots.

Verifier chooses its trust policy.

Avoid one mandatory Renova-controlled global root if federation is operationally required.

## 61. Trust policy

Verifier policy may specify:

- trusted roots;
- accepted issuer classes;
- required conformance;
- allowed algorithms;
- freshness;
- status SLA;
- accepted profile versions.

## 62. Trust anchor discovery

Possible mechanisms:

- well-known metadata;
- DNS/domain proof;
- signed registry;
- partner configuration.

Selection should be driven by security and partner needs.

## 63. Governance model

Before public standard positioning, define:

- protocol steward;
- change proposal process;
- review period;
- security review;
- backwards compatibility policy;
- deprecation timeline;
- emergency security changes.

## 64. Change proposals

Maintain numbered change proposals.

Each includes:

- problem;
- proposed semantics;
- compatibility impact;
- privacy/security impact;
- implementation examples;
- migration plan.

## 65. Security advisories

Public process for:

- vulnerability reporting;
- CVE/advisory where relevant;
- compromised algorithms/keys;
- urgent protocol mitigation;
- affected version notice.

## 66. Test vectors

Cryptographic/canonicalization test vectors are mandatory before external implementations.

A verifier should reproduce exact expected bytes/digests/signatures.

## 67. Interoperability events

Before calling the protocol interoperable, run plugfests with independent implementations:

- Renova issuer -> external verifier;
- external issuer -> Renova verifier;
- external issuer A -> external verifier B.

## 68. Standards adapters

Adapters may map to:

- ACORD;
- MISMO;
- IFC/openBIM;
- W3C Verifiable Credentials;
- DID/JWKS;
- national building logbooks;
- national property/renovation passport schemes.

Adapters remain separate packages from core protocol semantics.

## 69. W3C VC compatibility

A signed protocol artifact may be representable as or referenced by a VC where useful.

Do not require VC semantics for all implementations.

## 70. DID compatibility

Issuer IDs may support DID resolution.

Baseline must also support simpler enterprise key discovery.

## 71. BIM interoperability

Protocol may reference IFC/BIM objects/evidence.

It should not duplicate IFC geometry/model semantics.

## 72. Insurance interoperability

ACORD adapter may map profile data.

Renova protocol does not redefine insurance policy/claim semantics.

## 73. Mortgage/valuation interoperability

MISMO or partner adapters may map relevant evidence.

Renova protocol does not redefine underwriting/appraisal semantics.

## 74. National building logbooks

Where jurisdictions provide official digital logbooks/passports:

- reference official IDs;
- import verified source facts;
- export permitted mappings.

Official registry remains authority.

## 75. Certification programme

Future certification may include:

- Self-tested;
- Verified conformance;
- Certified issuer;
- Certified verifier;
- Certified exchange partner.

Exact labels must avoid implying professional/regulatory accreditation.

## 76. Certification evidence

Store:

- protocol version;
- conformance level;
- test suite version;
- test results;
- issued_at;
- expires_at;
- restrictions.

## 77. Continuous conformance

Partners may need periodic revalidation after:

- protocol major version;
- key/security changes;
- critical implementation update;
- repeated interoperability failures.

## 78. Reference deployment

Provide a demo network:

- synthetic owner;
- synthetic property;
- test issuer;
- test institution;
- issued lender profile;
- verification;
- revocation;
- supersession;
- transaction checkpoint.

This becomes the canonical integration tutorial.

## 79. Developer portal

Potential contents:

- API keys for sandbox;
- test identities;
- fixtures;
- docs;
- SDK downloads/packages;
- webhook tester;
- conformance reports.

## 80. Open-source boundary

Candidate components suitable for open source:

- schemas;
- canonicalization;
- verifier;
- conformance suite;
- SDKs;
- examples.

Potential proprietary components:

- owner operational graph;
- decision/governance workflows;
- institutional network orchestration;
- analytics;
- managed trust services.

Open protocol can increase ecosystem adoption without giving away all product differentiation.

## 81. License strategy

Choose explicit licenses for:

- specification;
- schemas;
- SDK/reference code;
- test vectors.

Avoid ambiguity before external adoption.

## 82. Trademark / compatibility claims

Define rules for:

- "Renova Protocol compatible";
- "Certified";
- logo/badge usage;
- version claims.

Do not allow misleading certification claims.

## 83. External issuer economics

Do not require issuers to pay merely to make technically valid evidence portable.

Commercial services may charge for:

- managed onboarding;
- hosted issuer/status service;
- certification;
- transaction workflows;
- enterprise support.

## 84. Anti-capture governance

Avoid making protocol changes solely to advantage one institution/vendor.

Publish changes and compatibility rationale.

## 85. Portability

Protocol artifacts should remain verifiable/exportable even if owner stops using hosted Renova, subject to status/issuer availability.

Avoid artificial lock-in.

## 86. Historical durability

Design for multi-year verification:

- key history;
- status history where needed;
- schema/profile archives;
- canonicalization stability;
- migration records.

## 87. Archival bundle

Portable archival bundle may include:

- artifact;
- manifest;
- issuer metadata snapshot;
- key/certificate chain;
- profile schema/version;
- verification receipt.

Current revocation still may require online status.

## 88. Threat model

Include:

- issuer impersonation;
- verifier confusion;
- canonicalization ambiguity;
- signature downgrade;
- replay;
- stale status;
- malicious extension fields;
- profile confusion;
- cross-purpose reuse;
- compromised issuer key;
- registry compromise;
- privacy leakage.

## 89. Cryptographic agility

Do not bind public protocol forever to one signature or hash primitive.

Govern deprecation/migration explicitly.

## 90. Privacy threat model

Test:

- correlating pseudonymous property IDs;
- over-broad manifests;
- verifier enumeration;
- status endpoint leakage;
- public registry leakage;
- cross-purpose linking.

## 91. Minimal-disclosure verification

A verifier checking validity should not need full property payload.

Protocol supports digest/status verification separate from content disclosure.

## 92. Replay protection

Requests/checkpoints may use:

- nonce;
- request ID;
- issued_at;
- expires_at;
- idempotency key;
- signature.

## 93. Clock policy

Define:

- timestamp format;
- acceptable skew;
- expiry semantics;
- verifier behavior when clock uncertainty exists.

## 94. Conformance CI

Reference repositories should run:

- schema validation;
- canonicalization vectors;
- cryptographic vectors;
- status fixtures;
- backwards compatibility;
- protocol examples.

## 95. Protocol release gate

A version is releasable only when:

- normative spec complete;
- schemas published;
- test vectors published;
- reference verifier passes;
- reference issuer passes;
- threat model reviewed;
- migration notes exist;
- at least one independent implementation/interoperability test exists for mature release claims.

## 96. Pilot adoption gate

Do not market as an industry standard until at least:

- one real owner flow;
- one real institution verifier;
- one external issuer or independent implementation;
- repeated successful verification;
- documented interoperability issues resolved.

Until then call it a proposed/open protocol.

## 97. Adoption metrics

Track:

- independent implementations;
- certified/conformant issuers;
- conformant verifiers;
- profiles used;
- cross-implementation verifications;
- reusable evidence events;
- verification failures;
- partner integration time.

## 98. Network metrics

Later measure:

- percentage of institutional requests fulfilled by reusable evidence;
- diligence delta usage;
- external issuer share;
- independent verifier share;
- repeat institutional workflows.

## 99. Strategic moat

The moat is not secret schemas.

It is:

```
open protocol
+ trusted issuers
+ accepted profiles
+ conformance
+ reusable verified history
+ owner operational graph
+ institutional workflows
+ accumulated interoperability
```

Open interoperability can increase the value of Renova's proprietary operating network.

## 100. Anti-patterns — REJECT

- calling a proprietary REST API an open standard;
- protocol with no normative schemas/test vectors;
- blockchain requirement without problem justification;
- one Renova root that every verifier must trust;
- issuer type treated as universal authority;
- hidden breaking changes;
- unverifiable certification badge;
- proprietary artifact format that cannot be exported;
- advanced cryptography blocking practical v1 adoption;
- "industry standard" claim before independent adoption.

## 101. Definition of Done — Protocol v0.x

- core object model specified;
- schemas exist;
- canonical encoding exists;
- digest/signature envelope exists;
- issuer metadata/status exists;
- profile registry exists;
- verification API semantics exist;
- conformance fixtures exist;
- reference verifier exists.

## 102. Definition of Done — Protocol v1 candidate

- stable compatibility/versioning rules;
- security/privacy threat model;
- key rotation/status tested;
- reference issuer + verifier;
- at least two SDKs;
- conformance CI;
- public docs;
- one independent integration.

## 103. Definition of Done — Ecosystem

- external issuers can publish;
- independent verifiers can verify;
- partner certification is scoped/versioned;
- multiple trust roots/registries can interoperate where required;
- profiles/checkpoints work across implementations;
- adoption metrics show repeated external use.

## 104. Strict sequencing

1. protocol core object model;
2. canonical encoding + digest rules;
3. issuer metadata + key discovery;
4. status/revocation/supersession;
5. normative schemas;
6. reference verifier;
7. reference sandbox issuer;
8. conformance/test vectors;
9. profile registry;
10. TypeScript/Python SDKs;
11. public developer docs;
12. independent partner implementation;
13. interoperability plugfest;
14. external issuer publishing;
15. partner certification;
16. standards adapters driven by real partner demand.
