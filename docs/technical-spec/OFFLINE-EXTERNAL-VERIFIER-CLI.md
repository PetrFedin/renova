# Renova — independent offline execution-proof CLI (candidate)

**Status: DRAFT / no institutional or production admission.** This command verifies a signed checkpoint's **cryptographic integrity** against a public key pinned through a separate trusted channel. It does **not** prove the current acceptance status, a current non-revocation decision, key custody, independently witnessed issuance time, or authority to release money.

## Inputs and example

- `checkpoint.json`: Renova execution checkpoint envelope containing `payload`, `signature`, and `checkpointSha256`.
- `trusted-public-key.json`: exactly one independently obtained public key entry with `issuerId`, `keyId`, `alg`, `status`, `publicKeyMultibase`. It is **not** the whole `/public-keys` response.
- `PIN_SHA256`: the SHA-256 fingerprint of the exact public key entry (including its identity and status), **verified and recorded via a channel independent of the proof and the JSON file under test**. Do not trust a pin delivered together with an untrusted checkpoint.

From the repository root, in the existing backend Python environment:

```bash
python backend/scripts/verify_execution_proof_offline.py \
  --envelope checkpoint.json \
  --trusted-key trusted-public-key.json \
  --pin "$PIN_SHA256" \
  --output verification-receipt.json
```

Omit `--output` to emit JSON to stdout instead. The output file must **not** exist; an existing file or symlink is never overwritten. Input files are bounded to **1 MiB** (envelope) and **16 KiB** (single public key). Non-UTF-8, malformed JSON, duplicate JSON object keys, nonfinite JSON constants, oversized/unreadable inputs and non-object roots are rejected.

## Exit codes

| Code | Meaning | Auditor action |
| --- | --- | --- |
| `0` | Pinned key matches; offline Ed25519 signature and checkpoint SHA-256 pass | Keep the receipt; separately verify online authority and key history |
| `1` | The mathematical verification or pinned-key trust check did not pass | Treat as **unverified**; do not use as completion or payment evidence |
| `2` | Missing, malformed, duplicate-key, oversized or unreadable input / CLI usage error | Correct input without changing the trust authority |
| `3` | Could not safely produce the output receipt | Do not assume a receipt was stored; inspect filesystem permissions/path |

Every generated receipt always has `releaseAuthorized: false`, `onlineStateChecked: false`, `canonicalProofCurrent: null`, `revocationCurrent: null`, `issuanceTimeIndependentlyVerified: false`, and `keyCustodyVerified: false`. A zero exit code **never** overrides these fields.

## Recommended external verification evidence pack

Preserve the original checkpoint bytes, the public key entry, how and when the public-key fingerprint was independently pinned, the generated receipt, exact repository commit/test run, and (if decision-making is needed) a separate online canonical-state and revocation acceptance receipt. None of these artifacts implies contractor/customer signature or bank/insurer endorsement by itself.

### Known limitations

- A registry copied from an email or checkpoint is **not** a trusted registry without out-of-band validation.
- A key marked `retired` can be mathematically valid while its claimed signing timestamp remains untrusted; a compromised old private key can backdate a signature.
- This code does not attest an immutable log, a current stage status, or external regulatory compliance.
- This is an additive read-only utility: no network, browser account, environment-key issuance, database write, cloud resource or billing step is required.
- Institutional trust issuance, independently witnessed key rotation/timestamps and external verifier governance remain in [Issue #714](https://github.com/PetrFedin/renova/issues/714). Independent reviewer [Issue #685](https://github.com/PetrFedin/renova/issues/685) and main protection [Issue #247](https://github.com/PetrFedin/renova/issues/247) still block release.
