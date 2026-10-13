# Renova Independent Witness — offline verification profile v1

**Candidate / no release authorization.** This profile verifies a *second* Ed25519 signature over an already-valid Renova checkpoint hash using a separately pinned witness public key. It is a cryptographic binding, not a timestamp-authority certificate, proof of organizational independence, notarization, bank/insurer reliance approval, or live verification of the repair.

## Required inputs

1. Canonical Renova checkpoint with exactly `payload`, `signature`, `checkpointSha256`.
2. A verified issuer public-key entry, with its independent status-sensitive SHA-256 fingerprint (never from the checkpoint itself).
3. A witness receipt with exactly `payload`, `signature`, `receiptSha256`, described below.
4. A **separately** verified witness public-key entry and its status-sensitive SHA-256 fingerprint, from a trust source independent of the witness receipt and checkpoint.

Both keys use the strict key-entry shape `issuerId`, `keyId`, `alg`, `status`, `publicKeyMultibase`. Same issuer ID or identical public key is rejected even if a claimed witness key ID is different. These tests detect trivial reuse, not organizational independence or collusion.

## Signed witness payload schema

```json
{
  "witnessVersion": "renova-execution-witness-v1",
  "alg": "Ed25519",
  "witnessId": "separately-identified-witness",
  "witnessKeyId": "witness-key-v1",
  "checkpointSha256": "64 lowercase hex of canonical Renova checkpoint",
  "checkpointIssuerId": "renova-platform",
  "checkpointKeyId": "renova-issuer-key",
  "checkpointIssuedAt": "2026-10-13T00:00:00+00:00",
  "observedAt": "2026-10-13T00:05:00+00:00"
}
```

The actual verifier requires exact schema fields, a valid Ed25519 signature over the canonical payload, and SHA-256 of `{payload,signature}` equal to `receiptSha256`. Extra fields at either level are rejected. A witness cannot sign a different checkpoint, issuer ID, key ID or issuance-time claim without detection.

Both `checkpointIssuedAt` and `observedAt` are **signed party claims**. The verifier compares UTC timestamps and rejects a witness-observed time earlier than the issuer-claimed time, but **cannot establish either time independently**. A colluding or compromised signer can backdate both.

## Non-authorizing result

`WITNESS_SIGNATURE_VERIFIED` requires an authentic Renova checkpoint with a separately pinned issuer key, a different witness key with independently pinned fingerprint, a valid witness signature and receipt hash, exact checkpoint binding, and chronologically consistent *claims*. It means **only** cryptographic witness binding.

The following fields are always conservative, even on success:

```json
{
  "independentWitnessTimeVerified": false,
  "witnessOrganizationalIndependenceVerified": false,
  "keyCustodyVerified": false,
  "onlineStateChecked": false,
  "canonicalProofCurrent": null,
  "revocationCurrent": null,
  "releaseAuthorized": false
}
```

A witness key marked `retired` can still verify mathematical historic integrity; a key marked `revoked` cannot pass current local trust. Neither key status is authenticated as *current online truth* by the offline process.

## Failure handling and tests

The profile denies missing/mismatched trust pins, same public key disguised under a new ID, reused issuer identity, malformed/extra witness data, unsupported algorithm, tampering, invalid signature, invalid receipt hash, checkpoint hash or issuer binding mismatch, invalid date syntax and backward chronology. Tests are in `backend/tests/test_offline_execution_witness.py`, and the reference verifier is `backend/app/services/offline_execution_witness.py`.

No witness signing endpoint, witness private key, external account, time service or live key registry is created here. Before any institutional reliance, Issue #714 still requires independent key-custody proof, public-key lifecycle transparency, witnessed time anchoring, immutable issuance receipts, online canonical state and revocation checks, and control against colluding signers. PR #683/#685 and protected-main bypass #247 remain release blockers.
