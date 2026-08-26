"""Source contract: warranty retry/offline replay must preserve one client identity."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OS_API = ROOT / "apps" / "mobile" / "lib" / "api" / "os.ts"
OFFLINE_QUEUE = ROOT / "apps" / "mobile" / "lib" / "offlineQueue.ts"


def _warranty_create_block() -> str:
    source = OS_API.read_text(encoding="utf-8")
    start = source.index("createWarrantyClaim: async")
    end = source.index("listWarrantyClaims:", start)
    return source[start:end]


def test_warranty_request_id_is_created_once_before_network_attempt():
    block = _warranty_create_block()
    identity = "const client_request_id = newWarrantyClientRequestId();"
    serialization = "const serialized = JSON.stringify({ ...body, client_request_id });"

    assert block.count(identity) == 1
    assert block.count(serialization) == 1
    assert block.index(identity) < block.index("try {")
    assert block.index(serialization) < block.index("try {")
    assert "JSON.stringify(body)" not in block


def test_same_serialized_body_is_used_for_online_attempt_and_offline_queue():
    block = _warranty_create_block()

    assert block.count("body: serialized") == 2
    assert "client_request_id" in block
    assert "await enqueue({" in block


def test_offline_flush_replays_stored_body_without_rebuilding_warranty_payload():
    source = OFFLINE_QUEUE.read_text(encoding="utf-8")

    assert "body: job.body" in source
    assert "const sorted = [...snapshot].sort" in source
    assert "updateJobBody" in source  # explicit manual conflict editing remains a separate action
