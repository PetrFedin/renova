# Renova — External Institutional Network Contract

**Date:** 2026-10-08  
**Status:** RESEARCH / EXTERNAL INSTITUTIONAL INTEROPERABILITY & GOVERNANCE CONTRACT  
**Implementation gate:** after Owner Digital Twin snapshot lineage, Property Trust Exchange Profiles, issuer/status infrastructure and purpose-scoped disclosure controls are qualified.  
**Depends on:** Owner Capital Governance & Portfolio Digital Twin, Property Trust Exchange Profiles, Property Trust Matrix, Decision Ledger, signed checkpoint / issuer lifecycle architecture.  
**Authority rule:** Renova coordinates requests, disclosure, verification and transaction checkpoints. It does not become lender, insurer, auditor, valuer, legal title authority, regulator, escrow, or transaction settlement system.

## 1. Purpose

External Institutional Network closes the loop between Renova's internal evidence graph and external institutions.

Core chain:

```
credentialed institution
-> signed / attributable request
-> purpose + scope
-> owner / authorised approval
-> purpose-specific profile
-> selective disclosure / data room
-> issued artifact / workspace
-> verification receipt
-> questions / supplemental evidence
-> checkpoint
-> expiry / revocation / supersession
-> reusable verified evidence
```

The goal is not generic document sharing.

The goal is a governed, reusable institutional exchange network around property and portfolio evidence.

## 2. Reuse existing Trust Exchange Profiles

This contract does not redefine:

- insurer_pre_loss.v1;
- insurer_claim_evidence.v1;
- lender_evidence.v1;
- recall_impact.v1;
- buyer / transfer profiles;
- disclosure receipt;
- redaction;
- file manifest;
- signed artifact semantics;
- expiry/revocation semantics.

Those remain defined by the Property Trust Exchange Profiles contract.

This layer orchestrates institutions and multi-step external workflows around those profiles.

## 3. Institution types

Candidate organisation classes:

- bank;
- lender;
- insurer;
- reinsurer;
- insurance adjuster;
- auditor;
- technical due diligence firm;
- valuer/appraiser;
- buyer;
- seller;
- fund administrator;
- fund/asset manager;
- property manager;
- manufacturer;
- authorised service provider;
- warranty administrator;
- regulator/public authority where legally appropriate;
- legal/notarial/transaction participant where supported.

Organisation type is not sufficient proof of authority.

## 4. Institutional identity

Each external institution has:

- organisation_id;
- legal name;
- jurisdiction;
- registration identifiers where sourced;
- organisation type;
- verified domains/contact methods;
- credential status;
- trust anchors/issuer metadata where implemented;
- authorised representatives;
- permissions/contracts;
- status.

Do not infer institutional legitimacy from email domain alone.

## 5. Credential states

Possible states:

- unverified;
- identity_checked;
- credentialed;
- restricted;
- suspended;
- expired;
- revoked.

Credentialing must retain:

- verifier;
- source;
- scope;
- issued_at;
- expires_at;
- revocation/status reference.

## 6. Representative identity

An institution request is attributable to:

- organisation;
- human/service representative;
- role;
- authority scope;
- authentication assurance;
- request timestamp.

A valid organisation does not mean every employee can request every profile.

## 7. Institutional request

Every request includes:

- request_id;
- requester organisation;
- representative;
- purpose;
- requested profile/version;
- property/portfolio scope;
- requested fields/categories;
- legal-basis/consent class where applicable;
- target deadline;
- validity period;
- callback/workspace mode;
- signature/attribution evidence where supported.

## 8. Signed request

Where issuer infrastructure supports it:

`canonical request -> digest -> requester signature -> credential/status reference`

Signed requests provide attribution and integrity.

They do not override owner consent, ACL or purpose limitation.

## 9. Request purposes

Examples:

- mortgage/refinancing diligence;
- lender technical review;
- insurance underwriting evidence request;
- insurance claim evidence;
- audit;
- technical due diligence;
- buyer diligence;
- sale transfer;
- fund administration;
- warranty verification;
- recall remediation;
- service verification.

Purpose drives allowable data.

## 10. Purpose limitation

A request for one purpose cannot silently expand.

Examples:

- insurance claim access does not grant buyer diligence access;
- lender evidence does not grant full owner chat history;
- technical due diligence does not grant portfolio financing terms.

Purpose changes require new approval/profile issuance.

## 11. Request lifecycle

Candidate states:

- received;
- identity_check;
- scope_review;
- owner_review;
- approved;
- partially_approved;
- rejected;
- issued;
- in_review;
- supplemental_evidence_requested;
- checkpoint_ready;
- completed;
- expired;
- revoked;
- superseded.

## 12. Owner approval

Before disclosure, show:

- who requests;
- why;
- exact property/portfolio;
- requested profile;
- categories requested;
- expiry;
- onward-sharing policy;
- expected outputs;
- revocation limits.

Owner/authorised actor may approve, narrow, reject or request clarification.

## 13. Institutional access modes

### Data room
Human review workspace.

### Portable artifact
Signed/manifested package.

### Verification API
Minimal authenticity/current-status check.

### Partner API
Contracted machine-to-machine flow.

### Recurring subscription
Purpose-bounded updates for a defined period.

All modes share profile and audit semantics.

## 14. Purpose-specific data room

A data room is generated from a frozen purpose-specific snapshot.

Includes only:

- authorised profile fields;
- authorised evidence;
- derived/redacted files;
- manifests;
- source references;
- coverage/freshness;
- verification state.

It is not a generic folder dump.

## 15. Data room states

- preparing;
- active;
- expired;
- revoked;
- superseded;
- archived.

Data room access is time-bounded and audited.

## 16. Frozen transaction snapshot

For diligence/transfer/refinancing, freeze:

- property/portfolio scope;
- source cutoff;
- evidence versions;
- profile version;
- exclusions/redactions;
- owner approval;
- artifact manifest.

This preserves what the institution actually reviewed.

## 17. Dynamic current-state view

Some workflows require current status after a frozen snapshot.

Expose separately:

- snapshot_as_issued;
- current_status;
- changes_since_issue.

Never silently mutate the issued snapshot.

## 18. Verification receipt

Every external verification action can produce a receipt:

- verifier organisation;
- representative/service;
- artifact/profile;
- digest/hash;
- verification time;
- signature validity;
- issuer status;
- revocation/status result;
- source cutoff;
- result code.

A verification receipt does not mean the institution endorses the property.

## 19. Review receipt

Institution may record:

- reviewed;
- questions_open;
- accepted_for_process;
- rejected_for_process;
- additional_evidence_required.

These are process states, not Renova-issued legal conclusions.

## 20. Supplemental evidence requests

External reviewer may request:

- missing source;
- updated inspection;
- current maintenance evidence;
- clearer asset identity;
- additional disclosure;
- authorised valuation report;
- revised redaction.

Request routes to Owner/Action Engine.

Institution cannot directly mutate owner property records.

## 21. Request-to-Action integration

Chain:

```
institutional request
-> profile evaluation
-> missing requirements
-> owner Recovery Plan
-> canonical actions
-> evidence
-> Trust Matrix recompute
-> updated bounded artifact
```

This closes institutional diligence into real remediation.

## 22. Transaction checkpoints

A checkpoint records a meaningful stage such as:

- initial evidence package issued;
- diligence completeness review;
- technical DD passed for process;
- insurer evidence package accepted for review;
- lender evidence refreshed;
- transfer disclosure approved;
- closing snapshot issued;
- post-transfer verification.

Checkpoint semantics are explicit per workflow.

## 23. Checkpoint identity

Store:

- checkpoint_id;
- transaction/request;
- institution;
- profile/artifact;
- snapshot;
- status;
- issued_at;
- effective_at;
- expires_at;
- evidence digest;
- decision/receipt references.

## 24. Checkpoint signing

When supported:

- owner/issuer signs issued checkpoint;
- institution may countersign receipt/acknowledgement;
- status list supports current/revoked/superseded.

Countersignature does not imply financial/legal approval unless explicitly defined by external institution.

## 25. Multi-party workflow

A transaction may involve:

- owner/seller;
- buyer;
- lender;
- insurer;
- technical DD;
- valuer;
- auditor;
- property manager.

Each party receives its own purpose-scoped projection.

No universal shared room with unrestricted cross-party visibility by default.

## 26. Information barriers

Support:

- party-specific folders/profiles;
- field-level redaction;
- commercial-value suppression;
- legal-entity isolation;
- bidder isolation;
- lender-only information;
- insurer-only claims information.

## 27. Buyer / seller workflow

Possible flow:

```
seller authorises
-> buyer_due_diligence profile
-> frozen data room
-> reviewer questions
-> remediation / supplemental evidence
-> disclosure checkpoint
-> transfer dossier
-> transaction cut
-> post-transfer handover
```

Renova does not negotiate price or execute sale.

## 28. Lender / refinancing workflow

Possible flow:

```
refinancing target
-> lender request
-> lender_evidence.v1
-> capital/trust blockers
-> owner remediation
-> refreshed profile
-> lender technical/valuation partner review
-> verification receipts
-> closing snapshot
```

No credit decision or approval probability.

## 29. Insurer workflow

Possible flows:

### Pre-loss
`owner baseline -> insurer_pre_loss.v1 -> periodic refresh -> claim linkage if event occurs`

### Claim
`loss -> insurer_claim_evidence.v1 -> supplemental evidence -> restoration -> accepted evidence package`

No coverage/liability/claim approval decision by Renova.

## 30. Auditor workflow

Purpose-specific evidence may include:

- capital approval lineage;
- programme execution;
- invoices/reconciliation references;
- asset changes;
- snapshot integrity;
- control evidence.

Renova does not issue audit opinion.

## 31. Technical DD workflow

Technical diligence may review:

- condition evidence;
- maintenance;
- major systems;
- defects;
- capital backlog;
- lifecycle history;
- source coverage;
- commissioning/inspection.

External technical conclusions remain authored by the DD provider.

## 32. Valuer workflow

Renova may provide:

- property facts;
- condition evidence;
- renovation history;
- area/source references;
- capital plan;
- major system history.

Valuer supplies valuation opinion.

Renova must not convert these facts into formal market value without appropriate authority.

## 33. Fund administrator workflow

Possible scoped data:

- asset/entity identity;
- approved capital;
- commitments;
- actual programme status;
- evidence packages;
- owner/IC approvals.

Accounting/NAV authority remains external.

## 34. Manufacturer / service network workflow

Institutional manufacturer/provider may:

- verify product identity;
- confirm warranty/service eligibility;
- confirm recall applicability;
- issue service/commissioning evidence;
- respond to parts/status requests.

Their responses require provenance/status.

## 35. Reusable verified evidence

Evidence already verified for one workflow may be reused if:

- purpose policy permits;
- source remains current;
- scope matches;
- no revocation;
- redaction requirements are compatible.

Reuse creates a new disclosure receipt.

Do not simply forward the old package blindly.

## 36. Evidence cache semantics

Cache may retain:

- verified digest;
- source version;
- verification result;
- verified_at;
- valid_until;
- verifier;
- purpose compatibility.

Stale cache cannot masquerade as current verification.

## 37. Institutional subscriptions

Recurring, purpose-bounded updates may be useful for:

- lender covenant/technical monitoring;
- insurer pre-loss evidence freshness;
- fund administration;
- property management oversight;
- warranty/service continuity.

Subscription requires:

- explicit duration;
- categories;
- update triggers;
- owner/legal basis;
- revocation path.

## 38. Subscription event triggers

Examples:

- major capital completion;
- major asset replacement;
- recall;
- maintenance lapse;
- transfer-readiness change;
- evidence revocation;
- ownership/control change.

Avoid streaming every minor event.

## 39. Institutional notification policy

Notifications must be:

- purpose relevant;
- material;
- scoped;
- rate-limited;
- auditable.

Do not notify institutions about unrelated owner activity.

## 40. Institution trust registry

Maintain a registry of:

- institution identity;
- credential status;
- accepted authentication;
- allowed profiles;
- contract/policy scope;
- API keys/client identity references;
- status/revocation;
- incident/restriction state.

Registry is operational trust, not a public reputational score.

## 41. Trust anchors

Potential publication/verification:

- JWKS;
- issuer metadata;
- DID-compatible identifiers where useful;
- certificate chains;
- signed organisation credentials.

Adopt interoperability based on partner need, not novelty.

## 42. Key rotation

Institution/issuer key lifecycle must support:

- active;
- scheduled rotation;
- retired verification-only;
- compromised/revoked;
- emergency rotation.

Artifacts retain enough metadata to verify historical signatures.

## 43. Status lists

Credential/artifact/checkpoint status may support:

- current;
- suspended;
- expired;
- revoked;
- superseded.

Status endpoint/list must be cacheable but freshness-bounded.

## 44. External verification interoperability

Verifier should be able to determine:

- who issued;
- what profile;
- canonical artifact digest;
- signature validity;
- current credential/key status;
- artifact status;
- issuance/source cutoff;
- whether a newer artifact supersedes it.

## 45. No account requirement for minimal verification

Where safe, an external verifier should be able to validate artifact authenticity/status without broad Renova account access.

No property detail beyond the verification response is disclosed.

## 46. Verification API privacy

Minimal response:

- valid signature yes/no;
- issuer;
- artifact type/version;
- issued_at;
- status;
- source cutoff;
- superseded/revoked state.

Avoid returning hidden property contents.

## 47. External questions workspace

Reviewers may post:

- clarification;
- missing evidence request;
- challenge;
- discrepancy.

Each question has:

- requester;
- scope;
- deadline;
- owner/assignee;
- linked evidence;
- resolution.

## 48. Discrepancy handling

If institution reports a discrepancy:

- record claim;
- preserve challenged source;
- route to reconciliation;
- admit correction only through canonical source process;
- issue superseding artifact if required.

External reviewer cannot directly overwrite Renova facts.

## 49. External reviewer annotations

Annotations must be visibly external and non-authoritative unless formally admitted.

Examples:

- reviewer note;
- valuation observation;
- technical DD finding;
- insurer question.

## 50. Institutional SLA

Optional contracted SLA can define:

- request acknowledgement;
- owner response;
- evidence refresh;
- verification availability;
- question response.

No fake SLA without contract/policy provenance.

## 51. Transaction workspace

A transaction workspace coordinates:

- parties;
- purposes;
- requests;
- issued profiles;
- questions;
- checkpoints;
- conditions;
- closing cut;
- post-close handover.

It does not replace legal transaction management systems unless explicitly integrated.

## 52. Closing evidence cut

At transaction close/refinance:

- freeze final approved snapshot;
- freeze disclosure manifest;
- record unresolved exceptions;
- record accepted waivers/conditions where externally authored;
- issue final checkpoint;
- archive current status references.

## 53. Post-transaction continuity

After ownership/control change:

- preserve seller historical snapshot;
- create new owner/control context;
- transfer only authorised transferable evidence;
- keep private/non-transferable data isolated;
- regenerate current profiles under new authority.

## 54. Institutional audit trail

Record:

- institution;
- representative;
- request;
- owner approval;
- fields/categories disclosed;
- artifact;
- downloads/views where supported;
- verification;
- questions;
- revocation;
- expiry;
- onward-share receipts where contract supports them.

## 55. Onward sharing

Profiles may define:

- prohibited;
- same-organisation only;
- named processors;
- named transaction parties;
- unrestricted after owner approval.

Technical controls cannot guarantee off-platform behavior; policy/receipt should state limits honestly.

## 56. Data retention

Retention policy must consider:

- owner policy;
- transaction obligations;
- institution contract;
- legal requirement;
- profile expiry.

Expiry of access does not necessarily mean destruction of legally retained institutional records.

Renova should not claim deletion outside its control.

## 57. Consent / legal basis boundary

System records provided consent/legal-basis metadata where applicable.

Renova does not determine legal sufficiency autonomously.

Organisation counsel/policy defines lawful basis.

## 58. Institutional API idempotency

External request/issuance/checkpoint APIs require:

- idempotency key;
- request digest;
- replay protection;
- duplicate detection;
- versioning;
- audit.

## 59. Webhook semantics

Partner webhook events may include:

- request.received;
- artifact.issued;
- artifact.revoked;
- artifact.superseded;
- verification.completed;
- question.created;
- checkpoint.updated.

Require signed webhooks / replay protection where supported.

## 60. Outage behavior

If external verification/status service is unavailable:

- do not report artifact valid/current;
- return verification_unavailable;
- preserve cached status with timestamp where policy allows;
- do not fabricate success.

## 61. Institutional incident handling

If institution credential/key compromised:

- suspend institution credential;
- revoke affected active sessions/tokens;
- assess issued requests/receipts;
- rotate keys;
- notify affected owners where required;
- preserve historical audit.

## 62. Fraud / impersonation controls

Potential controls:

- verified organisation onboarding;
- representative verification;
- domain verification;
- signed requests;
- phishing-resistant MFA;
- anomalous request review;
- high-risk manual verification.

Do not rely solely on display name/email.

## 63. Institution onboarding

Stages:

1. organisation application/invite;
2. identity/registry verification;
3. contract/policy configuration;
4. credential issuance;
5. allowed profiles/purposes;
6. representative enrolment;
7. sandbox/conformance;
8. production activation.

## 64. Conformance programme

Partners should pass:

- request schema;
- signature verification;
- status/revocation;
- redaction expectations;
- error semantics;
- idempotency;
- webhook verification;
- purpose enforcement;
- test artifacts.

## 65. Sandbox

Provide synthetic test properties/artifacts.

Never use live owner data for partner conformance by default.

## 66. Partner certification

Future partner programme may certify:

- technical interoperability;
- evidence handling conformance;
- profile compatibility.

Certification must not imply professional competence outside tested scope.

## 67. Institutional directory

An owner may discover credentialed partners by:

- institution type;
- supported profile;
- geography;
- integration mode;
- certification/conformance status.

No hidden pay-to-rank without explicit sponsored labeling.

## 68. Network reputation boundary

Do not create one universal lender/insurer/valuer/provider reputation score.

Operational metrics may include:

- response time;
- conformance pass rate;
- request completion;
- verification errors.

Keep context explicit.

## 69. Cross-institution reusable checkpoint

A checkpoint may be reusable across institutions only if:

- profile/purpose compatible;
- owner authorises;
- source freshness sufficient;
- receiving institution accepts schema/status;
- no revocation/supersession.

This can reduce repeated diligence.

## 70. Diligence delta package

Instead of reissuing full history every time, support:

`previous accepted snapshot -> changes since -> updated evidence -> new checkpoint`

This can materially reduce recurring verification workload.

## 71. Recurring verification

For long-lived lender/insurer/fund relationships:

- periodic current-status proof;
- change-triggered delta;
- refreshed coverage summary;
- renewed consent/authority where required.

## 72. Institutional request templates

Templates may encode:

- required profile;
- optional fields;
- evidence classes;
- freshness requirements;
- acceptable issuers;
- deadline.

Templates are institution policy, not Renova global truth.

## 73. Institutional policy mapping

Renova may map an external requirement set into:

- Trust Matrix requirements;
- Action Engine gaps;
- evidence profile fields;
- external response.

Keep external policy/version/source.

## 74. External requirement change

If institution changes policy:

- preserve old request/version;
- evaluate delta;
- identify new gaps;
- do not retroactively mark previous compliant artifact noncompliant unless institution status says so.

## 75. Portfolio-level institutional workflow

For portfolio refinancing/insurance/fund review:

- portfolio scope;
- property subprofiles;
- aggregate coverage;
- property exceptions;
- materiality;
- exact drill-down.

No aggregate hides critical property exceptions.

## 76. Portfolio data room

Structure:

- portfolio summary;
- entity/control;
- approved capital;
- material programmes;
- property folders/profiles;
- exceptions;
- verification receipts;
- disclosure manifest.

Financial/ownership data remains ACL/purpose scoped.

## 77. Institutional request queue

Owner/asset manager sees:

- institution;
- purpose;
- deadline;
- requested profile;
- completeness;
- owner action required;
- open questions;
- expiry.

## 78. Institutional workflow metrics

### Time to approved disclosure
`approved_at - request_received_at`

### Time to complete evidence
`checkpoint_ready_at - request_received_at`

### Reuse rate
`reused_verified_evidence / eligible_evidence`

### Supplemental request rate
`requests_needing_supplemental_evidence / issued_requests`

### Diligence delta efficiency
Compare delta workflow vs full re-review using measured process baseline.

### Verification failure rate
Signature/status/schema verification failures.

## 79. Owner value metrics

Measure:

- manual preparation hours;
- repeated document requests;
- evidence duplication;
- days to diligence-ready package;
- days to refinancing/transfer evidence readiness;
- number of stale/invalid disclosures prevented.

Do not claim transaction speed improvement before measured.

## 80. Institution value metrics

Possible measured:

- reviewer preparation time;
- missing-evidence loops;
- duplicate verification;
- stale document incidence;
- source traceability.

## 81. Commercial model

Possible later packaging:

### Owner Institutional Exchange
- controlled data rooms;
- disclosure receipts;
- institutional requests;
- transaction checkpoints.

### Enterprise Portfolio Exchange
- portfolio diligence;
- recurring lender/insurer/fund updates;
- delta packages;
- multi-property requests.

### Institution Integration
- partner API;
- verification API;
- conformance sandbox;
- templates.

### Network Services
Only after real adoption:
- partner certification;
- institutional directory;
- workflow transaction fees.

Do not monetise by selling owner data.

## 82. Network effects

Potential network effect:

more verified owners/properties
-> more institution acceptance
-> more reusable profiles/checkpoints
-> less repeated diligence
-> more incentive for institutions/providers to integrate.

This is only defensible if privacy/purpose controls remain strong.

## 83. Switching-cost boundary

Legitimate switching value may come from:

- accumulated verified history;
- decision lineage;
- reusable evidence;
- partner integrations;
- conformance.

Do not create artificial lock-in by blocking export.

## 84. Portability

Owner should be able to export:

- issued profiles;
- manifests;
- verification receipts;
- decision/evidence history within policy.

Interoperability strengthens trust.

## 85. Standards strategy

Potential adapters:

- ACORD;
- MISMO;
- IFC/openBIM;
- W3C VC / status mechanisms;
- DID/JWKS;
- national building logbooks/passports;
- partner-specific schemas.

Use standards where they solve a real partner interoperability problem.

## 86. External authority preservation

If an external institution authors:

- valuation;
- audit opinion;
- coverage decision;
- technical report;
- lending decision,

Renova stores/reference it with issuer/provenance.

Renova does not re-author the conclusion.

## 87. AI boundary

AI may:

- summarize request;
- map requested fields to existing profiles;
- identify likely missing evidence;
- draft response narrative;
- summarize reviewer questions;
- compare diligence deltas.

AI may not:

- approve disclosure;
- impersonate institution;
- sign as institution;
- fabricate legal basis;
- issue valuation/audit/coverage/lending conclusion;
- override redaction.

## 88. Security baseline

Required:

- strong institution authentication;
- scoped tokens;
- MFA/service credentials;
- signed requests/webhooks where practical;
- key rotation;
- status/revocation;
- least privilege;
- audit;
- rate limits;
- anomaly detection;
- secrets isolation.

## 89. Privacy baseline

Required:

- purpose limitation;
- minimisation;
- owner visibility;
- expiry;
- revocation where technically effective;
- no unrelated personal data;
- no unrestricted bulk portfolio scrape;
- bounded exports.

## 90. Threat cases

Test:

- fake lender request;
- revoked institution credential;
- compromised representative;
- replayed signed request;
- expired data room token;
- cross-bidder data leakage;
- profile escalation;
- stale artifact presented as current;
- revoked source;
- webhook replay;
- malicious supplemental request;
- unauthorized portfolio expansion.

## 91. Test matrix

Required:

- valid institution request;
- invalid credential;
- representative outside authority;
- purpose mismatch;
- owner partial approval;
- redacted issuance;
- revoked artifact;
- superseded artifact;
- status service outage;
- supplemental request;
- request-to-Action gap flow;
- checkpoint issuance;
- countersigned receipt;
- multi-party isolation;
- transaction closing cut;
- ownership change/post-close isolation;
- recurring subscription expiry;
- institutional policy version change;
- reusable evidence with incompatible purpose rejected;
- delta package exactness;
- webhook replay rejection;
- idempotent duplicate request.

## 92. Pilot design

Do not launch as an open marketplace.

Pilot with one or two real institutional flows:

### Preferred first pilot A — insurer
- pre-loss baseline;
- claim/restoration evidence;
- periodic refresh.

### Preferred first pilot B — lender/refinancing technical diligence
- lender_evidence.v1;
- bounded data room;
- supplemental request loop;
- refreshed checkpoint.

Measure:
- preparation time;
- request loops;
- stale evidence;
- reviewer usability;
- disclosure control;
- verification reliability.

## 93. Strategic moat

The strongest moat is not "data room software".

It is the network chain:

```
owner digital twin
+ verified property history
+ purpose-specific profiles
+ institution identity
+ signed requests
+ selective disclosure
+ verification receipts
+ transaction checkpoints
+ reusable evidence
+ status/revocation
+ institutional acceptance
```

If accepted by real institutions, the same verified history becomes reusable across recurring external workflows.

## 94. Anti-patterns — REJECT

- generic unrestricted data room;
- institution access because email domain looks legitimate;
- one consent covering all future purposes;
- lender/insurer/auditor conclusions authored by Renova;
- buyer and lender seeing each other's restricted information;
- artifact updated silently after issuance;
- stale verification shown as current;
- revocation without audit;
- "blockchain" used as substitute for identity/status/policy;
- open marketplace before institutional acceptance;
- monetising/selling owner data;
- AI approving disclosure or institutional decision.

## 95. Definition of Done — Identity & Requests

- institution identity/credential status exists;
- representative authority exists;
- request is attributable/versioned;
- purpose/profile/scope are explicit;
- owner approval can narrow request;
- all request states are auditable.

## 96. Definition of Done — Disclosure & Verification

- purpose-specific data room/artifact works;
- frozen snapshot exists;
- redaction/minimisation works;
- disclosure receipt exists;
- verification API reveals minimal status only;
- expiry/revocation/supersession works;
- source outage does not become fabricated success.

## 97. Definition of Done — Transaction Workflow

- questions/supplemental evidence loop exists;
- institutional gaps route to Action Engine;
- checkpoints are versioned;
- multi-party isolation works;
- closing cut exists;
- post-transfer authority/data separation works;
- reusable evidence creates a new governed disclosure.

## 98. Definition of Done — Network

- partner sandbox/conformance exists;
- recurring subscriptions are purpose bounded;
- delta packages are reproducible;
- institutional policy versions are preserved;
- metrics prove whether repeated diligence work actually decreases;
- no network feature expands Renova into external institution authority.

## 99. Strict sequencing

1. institution identity + credential registry;
2. representative authority;
3. signed/attributable request lifecycle;
4. purpose-scoped owner approval;
5. purpose-specific data room over existing Exchange Profiles;
6. verification receipts + status/revocation;
7. supplemental request -> Action Engine loop;
8. transaction checkpoints;
9. multi-party transaction workspace;
10. diligence delta packages;
11. recurring institutional subscriptions;
12. partner sandbox/conformance;
13. external interoperability standards/adapters;
14. partner directory/certification only after real adoption.
