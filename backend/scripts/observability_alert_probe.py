"""Run one explicitly confirmed staging observability alert-delivery probe."""
from __future__ import annotations

import argparse
import json
import sys

from app.core.logging_config import setup_logging
from app.core.observability_alert_probe import (
    AlertProbeConfigurationError,
    emit_staging_alert_probe,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Emit a synthetic Sentry error, OpenTelemetry error span and metric in staging. "
            "This does not by itself prove external alert delivery."
        )
    )
    parser.add_argument(
        "--confirm-staging",
        action="store_true",
        help="Required acknowledgement that this command is intentionally targeting staging.",
    )
    parser.add_argument(
        "--probe-id",
        help="Optional UUID supplied by the operator; a fresh UUID is generated when omitted.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the non-secret local emission receipt as JSON.",
    )
    return parser.parse_args()


def _render_text(receipt: dict[str, object]) -> str:
    return (
        "observability alert probe emitted locally: "
        f"probe_id={receipt['probe_id']} "
        f"release={receipt['release']} "
        f"artifact_digest={receipt['artifact_digest']} "
        f"sentry_emitted={str(receipt['sentry_emitted']).lower()} "
        f"trace_emitted={str(receipt['trace_emitted']).lower()} "
        f"metric_emitted={str(receipt['metric_emitted']).lower()} "
        "external_delivery_confirmed=false"
    )


def main() -> int:
    args = _parse_args()
    if not args.confirm_staging:
        print(
            "refusing observability alert probe without --confirm-staging",
            file=sys.stderr,
        )
        return 2

    setup_logging()
    try:
        receipt = emit_staging_alert_probe(probe_id=args.probe_id).to_dict()
    except AlertProbeConfigurationError as exc:
        print(f"observability alert probe refused: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
    else:
        print(_render_text(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
