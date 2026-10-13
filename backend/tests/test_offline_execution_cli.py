"""Subprocess contract for external, no-account offline verification."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.services.offline_execution_receipt import trust_anchor_fingerprint
from test_offline_execution_verifier import _signed

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_execution_proof_offline.py"


def _json_file(path: Path, value: dict) -> Path:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return path


def _invoke(
    tmp_path: Path,
    *,
    envelope=None,
    key=None,
    pin=None,
    output=None,
    envelope_path=None,
    key_path=None,
    extra_args=(),
):
    if envelope is None or key is None:
        envelope, key = _signed()
    envelope_file = envelope_path or _json_file(tmp_path / "envelope.json", envelope)
    key_file = key_path or _json_file(tmp_path / "public-key.json", key)
    args = [
        sys.executable, str(SCRIPT),
        "--envelope", str(envelope_file),
        "--trusted-key", str(key_file),
        "--pin", trust_anchor_fingerprint(key) if pin is None else pin,
    ]
    if output is not None:
        args.extend(["--output", str(output)])
    args.extend(extra_args)
    return subprocess.run(
        args, text=True, capture_output=True, timeout=20, check=False, cwd=tmp_path,
    )


def test_cli_clean_proof_reports_only_offline_integrity(tmp_path):
    process = _invoke(tmp_path)
    assert process.returncode == 0, process.stderr
    assert process.stderr == ""
    receipt = json.loads(process.stdout)
    assert receipt["status"] == "OFFLINE_SIGNATURE_VERIFIED"
    assert receipt["cryptographicSignatureValid"] is True
    assert receipt["checkpointHashValid"] is True
    assert receipt["pinnedTrustAnchorMatched"] is True
    assert receipt["releaseAuthorized"] is False
    assert receipt["onlineStateChecked"] is False
    assert receipt["canonicalProofCurrent"] is None
    assert receipt["revocationCurrent"] is None
    assert receipt["issuanceTimeIndependentlyVerified"] is False
    assert receipt["keyCustodyVerified"] is False
    assert len(receipt["limitations"]) >= 4


def test_cli_writes_new_receipt_with_exclusive_permissions(tmp_path):
    dest = tmp_path / "new-receipt.json"
    process = _invoke(tmp_path, output=dest)
    assert process.returncode == 0, process.stderr
    assert process.stdout == ""
    receipt = json.loads(dest.read_text(encoding="utf-8"))
    assert receipt["offlineIntegrityPassed"] is True
    if os.name == "posix":
        assert dest.stat().st_mode & 0o777 == 0o600


def test_cli_refuses_to_replace_existing_receipt(tmp_path):
    output = tmp_path / "existing.json"
    output.write_text("do not overwrite", encoding="utf-8")
    process = _invoke(tmp_path, output=output)
    assert process.returncode == 3
    assert output.read_text(encoding="utf-8") == "do not overwrite"
    assert "output_unavailable_or_exists" in process.stderr


def test_cli_refuses_output_symlink(tmp_path):
    target = tmp_path / "original.txt"
    target.write_text("unchanged", encoding="utf-8")
    link = tmp_path / "receipt.json"
    try:
        link.symlink_to(target)
    except (NotImplementedError, OSError):
        pytest.skip("symlink creation unavailable")
    process = _invoke(tmp_path, output=link)
    assert process.returncode == 3
    assert target.read_text(encoding="utf-8") == "unchanged"


def test_cli_returns_machine_readable_denial_and_nonzero_exit_for_wrong_pin(tmp_path):
    denied = _invoke(tmp_path, pin="0" * 64)
    assert denied.returncode == 1
    receipt = json.loads(denied.stdout)
    assert receipt["status"] == "TRUST_PIN_MISMATCH"
    assert receipt["offlineIntegrityPassed"] is False
    assert receipt["releaseAuthorized"] is False


def test_cli_returns_nonzero_for_signed_payload_tamper(tmp_path):
    envelope, key = _signed()
    envelope["payload"]["subject"]["stageId"] = "different-stage"
    denied = _invoke(tmp_path, envelope=envelope, key=key)
    assert denied.returncode == 1
    assert json.loads(denied.stdout)["status"] == "INVALID_SIGNATURE"


def test_cli_rejects_revoked_even_when_signature_mathematically_valid(tmp_path):
    envelope, key = _signed()
    key["status"] = "revoked"
    result = _invoke(tmp_path, envelope=envelope, key=key)
    assert result.returncode == 1
    receipt = json.loads(result.stdout)
    assert receipt["status"] == "REVOKED_KEY"
    assert receipt["cryptographicSignatureValid"] is True
    assert receipt["releaseAuthorized"] is False


def test_cli_rejects_malformed_envelope_json(tmp_path):
    envelope, key = _signed()
    path = tmp_path / "malformed.json"
    path.write_text('{"payload":{,}', encoding="utf-8")
    result = _invoke(tmp_path, envelope=envelope, key=key, envelope_path=path)
    assert result.returncode == 2
    assert result.stdout == ""
    assert "invalid_json" in result.stderr


@pytest.mark.parametrize("malformed", [
    '{"payload": 1, "payload": 2}',
    '{"payload": {"subject": {"a": 1, "a": 2}}}',
    '{"payload": NaN}',
    '{"payload": Infinity}',
    "[1,2,3]",
])
def test_cli_rejects_duplicate_or_nonfinite_json_fields(tmp_path, malformed):
    envelope, key = _signed()
    path = tmp_path / "malformed.json"
    path.write_text(malformed, encoding="utf-8")
    result = _invoke(tmp_path, envelope=envelope, key=key, envelope_path=path)
    assert result.returncode == 2
    assert result.stdout == ""


def test_cli_rejects_invalid_utf8(tmp_path):
    envelope, key = _signed()
    path = tmp_path / "invalid.json"
    path.write_bytes(b'{"payload":"\xff"}')
    result = _invoke(tmp_path, envelope=envelope, key=key, envelope_path=path)
    assert result.returncode == 2
    assert "invalid_json" in result.stderr


@pytest.mark.parametrize("kind,size", [
    ("envelope", 1_048_577),
    ("public-key", 16_385),
])
def test_cli_rejects_oversized_input(tmp_path, kind, size):
    envelope, key = _signed()
    large = tmp_path / "oversized.json"
    large.write_bytes(b"x" * size)
    kwargs = {"envelope_path": large} if kind == "envelope" else {"key_path": large}
    result = _invoke(tmp_path, envelope=envelope, key=key, **kwargs)
    assert result.returncode == 2
    assert result.stdout == ""
    assert "input_too_large" in result.stderr


def test_cli_rejects_unavailable_input(tmp_path):
    envelope, key = _signed()
    result = _invoke(
        tmp_path, envelope=envelope, key=key,
        envelope_path=tmp_path / "does-not-exist.json",
    )
    assert result.returncode == 2
    assert result.stdout == ""
    assert "input_file_unavailable" in result.stderr


def test_cli_rejects_missing_independent_pin_option(tmp_path):
    envelope, key = _signed()
    ef = _json_file(tmp_path / "input.json", envelope)
    kf = _json_file(tmp_path / "key.json", key)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--envelope", str(ef), "--trusted-key", str(kf)],
        cwd=tmp_path, text=True, capture_output=True, check=False, timeout=20,
    )
    assert result.returncode == 2
    assert result.stdout == ""
    assert "--pin" in result.stderr


def test_cli_rejects_nonexistent_output_parent_without_stdout_leak(tmp_path):
    output = tmp_path / "absent-dir" / "receipt.json"
    result = _invoke(tmp_path, output=output)
    assert result.returncode == 3
    assert result.stdout == ""
    assert not output.exists()


@pytest.mark.asyncio
async def test_cli_verifies_real_renova_issuer_checkpoint(tmp_path, db, monkeypatch):
    """Cross-check CLI with the actual issuer canonical signature/hash bytes."""
    import base64
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from app.core.config import settings
    from app.services import execution_proof_trust_service as trust

    signer = Ed25519PrivateKey.generate()
    private_raw = signer.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = signer.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    monkeypatch.setattr(
        settings, "execution_proof_signing_private_key_b64",
        base64.urlsafe_b64encode(private_raw).decode("ascii").rstrip("="),
    )
    monkeypatch.setattr(settings, "execution_proof_signing_key_id", "cli-fixture-key")
    monkeypatch.setattr(settings, "execution_proof_issuer_id", "renova-cli-fixture")
    monkeypatch.setattr(settings, "execution_proof_trusted_public_keys_json", None)

    async def proof_fixture(_db, *, project_id, stage_id):
        assert (project_id, stage_id) == ("cli-project", "cli-stage")
        return {
            "proofHashSha256": "a" * 64,
            "sourceRecordHashSha256": "b" * 64,
            "evidence": {"level": "E2"},
            "acceptance": {"status": "accepted"},
        }

    monkeypatch.setattr(
        trust.execution_records, "get_portable_execution_proof", proof_fixture,
    )
    envelope = await trust.issue_checkpoint(
        db, project_id="cli-project", stage_id="cli-stage",
    )
    key = {
        "issuerId": "renova-cli-fixture", "keyId": "cli-fixture-key",
        "alg": "Ed25519", "status": "active",
        "publicKeyMultibase": "u" + base64.urlsafe_b64encode(public_raw).decode("ascii").rstrip("="),
    }
    process = _invoke(tmp_path, envelope=envelope, key=key)
    assert process.returncode == 0, process.stderr
    receipt = json.loads(process.stdout)
    assert receipt["status"] == "OFFLINE_SIGNATURE_VERIFIED"
    assert receipt["checkpointSha256"] == envelope["checkpointSha256"]
    assert receipt["signedIssuerId"] == "renova-cli-fixture"
    assert receipt["signedKeyId"] == "cli-fixture-key"
    assert receipt["releaseAuthorized"] is False


@pytest.mark.skipif(not hasattr(os, "O_NOFOLLOW"), reason="kernel O_NOFOLLOW unavailable")
def test_cli_rejects_symlink_input_before_read(tmp_path):
    envelope, key = _signed()
    real = _json_file(tmp_path / "original-envelope.json", envelope)
    symlink = tmp_path / "untrusted-alias.json"
    try:
        symlink.symlink_to(real)
    except (NotImplementedError, OSError):
        pytest.skip("symlinks unavailable")
    process = _invoke(tmp_path, envelope=envelope, key=key, envelope_path=symlink)
    assert process.returncode == 2
    assert process.stdout == ""
    assert "input_file_unavailable" in process.stderr


@pytest.mark.skipif(not hasattr(os, "mkfifo") or not hasattr(os, "O_NONBLOCK"), reason="FIFO support unavailable")
def test_cli_refuses_fifo_input_without_waiting_for_writer(tmp_path):
    envelope, key = _signed()
    fifo = tmp_path / "checkpoint-pipe.json"
    os.mkfifo(fifo)
    process = _invoke(tmp_path, envelope=envelope, key=key, envelope_path=fifo)
    assert process.returncode == 2
    assert process.stdout == ""
    assert "input_not_regular_file" in process.stderr
