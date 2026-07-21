"""WS Redis envelope: instance_id prevents echo loops."""
from app.services.ws_redis_bridge import INSTANCE_ID, pack_message, unpack_message


def test_pack_unpack_roundtrip():
    packed = pack_message({"type": "message", "id": "1"})
    from_id, body = unpack_message(packed)
    assert from_id == INSTANCE_ID
    assert '"type": "message"' in body or '"type":"message"' in body


def test_unpack_ignores_legacy_plain():
    from_id, body = unpack_message('{"type": "ping"}')
    assert from_id is None
    assert "ping" in body
