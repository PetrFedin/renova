"""Offline verifier command-line entrypoint.

Example (the 64-char pin MUST be obtained through an independent trusted channel):
    python backend/scripts/verify_execution_proof_offline.py \
        --envelope checkpoint.json \
        --trusted-key trusted-public-key.json \
        --pin <out-of-band-pinned-sha256> \
        --output receipt.json

Exit codes: 0 mathematically verified with pinned anchor, 1 verification denied,
2 malformed/missing input, 3 receipt output failed. NEVER authorizes release.
"""
from __future__ import annotations

import argparse
import json
import os
import stat
import sys
from pathlib import Path
from typing import Any

# Make the CLI work from any current directory without installing a new package.
_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.offline_execution_receipt import build_offline_receipt  # noqa: E402

_MAX_ENVELOPE_BYTES = 1_048_576
_MAX_TRUST_KEY_BYTES = 16_384


class InputError(ValueError):
    pass


def _no_duplicate_fields(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for key, value in pairs:
        if key in data:
            raise InputError("duplicate_json_field")
        data[key] = value
    return data


def _reject_nonfinite(_token: str) -> None:
    raise InputError("nonfinite_json_value")


def _read_bounded_object(path: Path, size_limit: int) -> dict[str, Any]:
    # Do not block on FIFOs/devices or follow a swapped-in input symlink.
    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0)
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, "rb") as handle:
            metadata = os.fstat(handle.fileno())
            if not stat.S_ISREG(metadata.st_mode):
                raise InputError("input_not_regular_file")
            if metadata.st_size > size_limit:
                raise InputError("input_too_large")
            raw = handle.read(size_limit + 1)
    except OSError as exc:
        raise InputError("input_file_unavailable") from exc
    if len(raw) > size_limit:
        raise InputError("input_too_large")
    try:
        obj = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_no_duplicate_fields,
            parse_constant=_reject_nonfinite,
        )
    except (UnicodeError, ValueError, RecursionError, TypeError) as exc:
        raise InputError("invalid_json") from exc
    if not isinstance(obj, dict):
        raise InputError("expected_json_object")
    return obj


def _write_exclusive(path: Path, output: str) -> None:
    """Never overwrite an existing receipt or follow an existing output symlink."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    created = True
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as writer:
            writer.write(output)
    except BaseException:
        if created:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def run_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Offline Renova checkpoint verifier: requires a public key AND a "
            "SHA256 pin obtained independently from the checkpoint. "
            "It never verifies live status or authorizes release."
        )
    )
    parser.add_argument("--envelope", required=True, type=Path, help="Checkpoint JSON file (max 1 MiB)")
    parser.add_argument("--trusted-key", required=True, type=Path, help="Independently obtained public-key JSON file (max 16 KiB)")
    parser.add_argument("--pin", required=True, help="Out-of-band lowercase SHA256 fingerprint of exact public key + status")
    parser.add_argument("--output", type=Path, help="New receipt JSON path; never overwrites existing files (default: stdout)")
    args = parser.parse_args(argv)

    try:
        envelope = _read_bounded_object(args.envelope, _MAX_ENVELOPE_BYTES)
        trusted_key = _read_bounded_object(args.trusted_key, _MAX_TRUST_KEY_BYTES)
    except InputError as exc:
        print(f"Renova offline verifier: {exc}", file=sys.stderr)
        return 2

    receipt = build_offline_receipt(
        envelope, trusted_key, pinned_trust_anchor_sha256=args.pin,
    )
    serialized = json.dumps(
        receipt, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False,
    ) + "\n"
    if args.output is None:
        try:
            sys.stdout.write(serialized)
        except (OSError, BrokenPipeError):
            return 3
    else:
        try:
            _write_exclusive(args.output, serialized)
        except OSError:
            print("Renova offline verifier: output_unavailable_or_exists", file=sys.stderr)
            return 3
    return 0 if receipt["offlineIntegrityPassed"] is True else 1


if __name__ == "__main__":
    raise SystemExit(run_cli())
