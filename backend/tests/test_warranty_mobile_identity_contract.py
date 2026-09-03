"""Source contract: warranty retry/offline replay preserves one client identity."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]; OS_API=ROOT/"apps"/"mobile"/"lib"/"api"/"os.ts"; OFFLINE_QUEUE=ROOT/"apps"/"mobile"/"lib"/"offlineQueue.ts"
def _block():
    source=OS_API.read_text(encoding="utf-8"); start=source.index("createWarrantyClaim: async"); end=source.index("listWarrantyClaims:",start); return source[start:end]
def test_request_id_created_once_before_network_attempt():
    block=_block(); identity="const client_request_id = newWarrantyClientRequestId();"; serialization="const serialized = JSON.stringify({ ...body, client_request_id });"; assert block.count(identity)==1 and block.count(serialization)==1 and block.index(identity)<block.index("try {") and block.index(serialization)<block.index("try {") and "JSON.stringify(body)" not in block
def test_same_serialized_body_online_and_queue():
    block=_block(); assert block.count("body: serialized")==2 and "await enqueue({" in block
def test_network_and_5xx_queue_but_4xx_do_not():
    block=_block(); assert "e instanceof ApiError && e.status >= 400 && e.status < 500" in block and block.index("e.status >= 400")<block.index("await enqueue({")
def test_offline_flush_replays_stored_body():
    source=OFFLINE_QUEUE.read_text(encoding="utf-8"); assert "body: job.body" in source and "const sorted = [...snapshot].sort" in source and "updateJobBody" in source
